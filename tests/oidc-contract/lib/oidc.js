import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config, discoveryUrl } from './config.js';
import { Session, http } from './http.js';
import { knownSecret, nextCode, rememberSecret, base32Decode } from './totp.js';

// ---------- small utilities ----------

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const rand = (n = 24) => b64url(randomBytes(n));

export function pkcePair() {
  const verifier = rand(48); // 64 chars, within 43..128 (RFC 7636 section 4.1)
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function decodeJwtPart(jwt, i) {
  return JSON.parse(Buffer.from(jwt.split('.')[i], 'base64url').toString('utf8'));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3]);
  }
  return out;
}

// Returns [{ action, method, fields: {name: value}, inputs: [{name,type,value}] }]
export function parseForms(html) {
  const forms = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const a = attrs(m[1]);
    const inputs = [...m[2].matchAll(/<input\b([^>]*)>/gi)].map((i) => attrs(i[1])).filter((i) => i.name);
    forms.push({
      action: a.action,
      method: (a.method ?? 'get').toLowerCase(),
      inputs,
      fields: Object.fromEntries(inputs.filter((i) => i.type === 'hidden').map((i) => [i.name, i.value ?? ''])),
      has: (name) => inputs.some((i) => i.name === name),
    });
  }
  return forms;
}

// ---------- discovery / JWKS ----------

let discoveryCache;
export async function discovery() {
  if (!discoveryCache) {
    const r = await http(discoveryUrl());
    if (r.status !== 200 || !r.json) {
      throw new Error(`Discovery failed: GET ${discoveryUrl()} -> HTTP ${r.status}. Is the provider up and ISSUER correct?`);
    }
    discoveryCache = r.json;
  }
  return discoveryCache;
}

export async function jwks() {
  const d = await discovery();
  return createRemoteJWKSet(new URL(d.jwks_uri), { cooldownDuration: 0, timeoutDuration: config.httpTimeoutMs });
}

// Full ID token validation as an RP must do it (OIDC Core 3.1.3.7): signature, iss, aud, exp.
export async function verifyIdToken(idToken, { nonce } = {}) {
  const d = await discovery();
  const { payload, protectedHeader } = await jwtVerify(idToken, await jwks(), {
    issuer: d.issuer,
    audience: config.clientId,
    algorithms: d.id_token_signing_alg_values_supported,
    clockTolerance: 5,
  });
  if (nonce !== undefined && payload.nonce !== nonce) throw new Error('nonce mismatch');
  return { payload, header: protectedHeader };
}

// ---------- authorization endpoint ----------

export class LoginBlocked extends Error {} // precondition missing (e.g. TOTP): test must be skipped with the reason
export class LoginFailed extends Error {}  // credentials rejected

export function authorizeParams(overrides = {}, { pkce = true } = {}) {
  const p = pkce ? pkcePair() : {};
  const params = {
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state: rand(12),
    nonce: rand(12),
    ...(pkce ? { code_challenge: p.challenge, code_challenge_method: 'S256' } : {}),
    ...overrides,
  };
  for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];
  return { params, verifier: p.verifier };
}

export async function authorizeUrl(params) {
  const d = await discovery();
  const u = new URL(d.authorization_endpoint);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.href;
}

// Follows redirects that stay on the provider's origin. Stops (and reports `redirect`) at the first
// redirect that leaves it or that targets the redirect_uri we sent (never actually fetched).
export async function followAuth(session, url, init, stopPrefixes = [config.redirectUri]) {
  const origin = new URL((await discovery()).authorization_endpoint).origin;
  let r = await session.request(url, init);
  for (let i = 0; i < 10; i++) {
    r.page = url;
    if (r.status >= 300 && r.status < 400 && r.location) {
      const leaves = new URL(r.location).origin !== origin || stopPrefixes.some((p) => r.location.startsWith(p));
      if (leaves) return { ...r, redirect: r.location };
      url = r.location;
      r = await session.request(url);
      continue;
    }
    return r;
  }
  throw new Error('too many redirects while driving the authorization endpoint');
}

export const isPasswordForm = (html) => parseForms(html).some((f) => f.inputs.some((i) => i.type === 'password'));

// Raw authorization request, no login. Returns the final response (see followAuth).
export async function rawAuthorize(overrides = {}, opts = {}) {
  const { params, verifier } = authorizeParams(overrides, opts);
  const r = await followAuth(new Session(), await authorizeUrl(params), undefined, [overrides.redirect_uri ?? config.redirectUri]);
  return { ...r, params, verifier };
}

// Interprets a response to an authorization request that must NOT have progressed to a login/consent.
export function describeAuthOutcome(r) {
  if (r.redirect) {
    const u = new URL(r.redirect);
    const q = u.searchParams;
    const frag = new URLSearchParams(u.hash.replace(/^#/, ''));
    return { kind: 'redirect', url: r.redirect, error: q.get('error') ?? frag.get('error'), code: q.get('code') ?? frag.get('code'), state: q.get('state') ?? frag.get('state'), iss: q.get('iss') ?? frag.get('iss'), token: frag.get('access_token') ?? q.get('access_token') };
  }
  if (r.status === 200 && isPasswordForm(r.text)) return { kind: 'login-form' };
  return { kind: 'page', status: r.status };
}

// Full interactive login through the provider's HTML form. Returns the authorization response params.
export async function login(overrides = {}, { username = config.user, password = config.password, pkce = true, session = new Session() } = {}) {
  const { params, verifier } = authorizeParams(overrides, { pkce });
  const stop = [params.redirect_uri];
  let r = await followAuth(session, await authorizeUrl(params), undefined, stop);
  let submittedPassword = false;
  let otpAttempts = 0;

  for (let step = 0; step < 8; step++) {
    if (r.redirect) break;
    const forms = r.status === 200 ? parseForms(r.text) : [];
    const pwForm = forms.find((f) => f.inputs.some((i) => i.type === 'password'));
    const otpForm = forms.find((f) => f.has('otp'));
    const enrollForm = forms.find((f) => f.has('totp') && /totpSecret/.test(r.text));
    let form;
    let fields;
    if (pwForm) {
      if (submittedPassword) throw new LoginFailed(`login form shown again after submitting credentials (user ${username})`);
      submittedPassword = true;
      form = pwForm;
      fields = { ...pwForm.fields, username, password };
    } else if (otpForm) {
      const secret = knownSecret();
      if (!secret) throw new LoginBlocked('provider asks for a one-time code but no TOTP secret is known (set TEST_TOTP_SECRET, or TOTP_AUTO_ENROLL=1 on a fresh user)');
      if (++otpAttempts > 1) throw new LoginFailed('one-time code was rejected');
      form = otpForm;
      fields = { ...otpForm.fields, otp: await nextCode(secret) };
    } else if (enrollForm) {
      if (!config.autoEnroll) {
        throw new LoginBlocked(
          `test user "${username}" is forced through "configure authenticator app (TOTP)" on first login. ` +
            'Enrol once and set TEST_TOTP_SECRET, or run with TOTP_AUTO_ENROLL=1 against a fresh provider.',
        );
      }
      const SECRET_RE = /id="kc-totp-secret-key"[^>]*>([^<]+)</;
      let shown = SECRET_RE.exec(r.text)?.[1];
      let enroll = enrollForm;
      if (!shown) {
        // Keycloak 26 shows only the QR code first; the text key is on the page behind "Unable to scan?" (id mode-manual).
        const link = /<a\b[^>]*\bid="mode-manual"[^>]*>/i.exec(r.text)?.[0];
        const href = link && /\bhref="([^"]*)"/i.exec(link)?.[1];
        if (href) {
          const mr = await followAuth(session, new URL(decodeHtml(href), r.page).href, undefined, stop);
          if (mr.status === 200) {
            r = mr;
            shown = SECRET_RE.exec(r.text)?.[1];
            enroll = parseForms(r.text).find((f) => f.has('totp') && /totpSecret/.test(r.text)) ?? enrollForm;
          }
        }
      }
      if (!shown) {
        const redact = (t) => t.replace(/[A-Za-z0-9+/=_-]{16,}/g, '[REDACTED]').replace(/(?:[A-Z2-7]{4} ){3,}[A-Z2-7]{1,4}/g, '[REDACTED]').replace(/\s+/g, ' ');
        const ids = [...new Set([...r.text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))].filter((i) => /secret|totp|key|manual|mode|barcode|qr/i.test(i)).join(',');
        const i0 = r.text.search(/totpSecret/);
        const win = redact(r.text.slice(Math.max(0, i0 - 150), i0 + 350));
        throw new LoginBlocked(`TOTP enrolment page found but the manual-entry secret could not be parsed (provider theme differs from Keycloak 26 default). DIAG ids=[${ids}] window=${win}`);
      }
      const secret = decodeHtml(shown).replace(/\s+/g, '');
      base32Decode(secret); // validates
      rememberSecret(secret);
      form = enroll;
      fields = { ...enroll.fields, totp: await nextCode(secret), userLabel: 'oidc-contract-test' };
    } else {
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(r.text)?.[1]?.trim() ?? '';
      throw new LoginBlocked(`login flow stopped on an unhandled page (HTTP ${r.status}, title "${decodeHtml(title).slice(0, 80)}"); a required action or consent screen is probably pending for ${username}`);
    }
    const action = new URL(form.action, r.page).href;
    r = await followAuth(session, action, { method: 'POST', form: fields, headers: { referer: r.page } }, stop);
  }
  if (!r.redirect) throw new LoginBlocked('login did not end in a redirect to the redirect_uri');
  const out = describeAuthOutcome(r);
  if (out.error) throw new LoginFailed(`authorization error after login: ${out.error}`);
  if (!out.code) throw new LoginFailed('redirect after login carried no code');
  return { ...out, params, verifier, session };
}

// Skips the calling test with a clear reason when the login precondition is not met.
export async function tryLogin(t, overrides, opts) {
  try {
    return await login(overrides, opts);
  } catch (e) {
    if (e instanceof LoginBlocked) {
      t.skip(`SKIPPED (precondition): ${e.message}`);
      return null;
    }
    throw e;
  }
}

// ---------- token / userinfo ----------

export async function tokenRequest(form, { clientId = config.clientId, auth = true } = {}) {
  const d = await discovery();
  const body = { ...form };
  if (auth) {
    if (config.clientSecret && clientId === config.clientId) body.client_secret = config.clientSecret;
    if (clientId !== undefined) body.client_id = clientId;
  }
  return http(d.token_endpoint, { method: 'POST', form: body });
}

export function codeExchange(l, overrides = {}) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code: l.code,
    redirect_uri: l.params.redirect_uri,
    code_verifier: l.verifier,
    ...overrides,
  });
}

export async function loginAndTokens(overrides, opts) {
  const l = await login(overrides, opts);
  const r = await codeExchange(l);
  if (r.status !== 200) throw new Error(`code exchange failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  return { ...l, tokens: r.json };
}

export async function userinfo(token, init = {}) {
  const d = await discovery();
  if (!d.userinfo_endpoint) throw new Error('discovery has no userinfo_endpoint');
  return http(d.userinfo_endpoint, { headers: token ? { authorization: `Bearer ${token}` } : {}, ...init });
}
