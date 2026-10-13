// ============================================================================
// MOCK OPENID PROVIDER - TEST SELF-CHECK ONLY. NOT AN IDENTITY PROVIDER.
// Purpose: prove the contract tests themselves can pass and can fail, in a sandbox without Keycloak.
// It stores everything in memory, has one hard-coded user, and must never be used for anything else.
// Passing against this mock says NOTHING about Keycloak or about any real provider.
// Defects can be injected with MOCK_BUGS=comma,list to check that tests notice them:
//   totp-enroll (forces first-login TOTP setup like the Keycloak realm, then an OTP prompt on later logins),
//   open-redirect, no-pkce, replay, no-state, no-nonce, no-binding, wrong-iss, no-rotate, userinfo-open, no-iss
// ============================================================================
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { base32Decode, hotp } from '../lib/totp.js';

const b64url = (b) => Buffer.from(b).toString('base64url');
const rnd = () => randomBytes(24).toString('base64url');

export async function startMock({ port = 0, bugs = (process.env.MOCK_BUGS ?? '').split(',').filter(Boolean) } = {}) {
  const has = (b) => bugs.includes(b);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'mock-key-1', alg: 'RS256', use: 'sig' };
  const REGISTERED = new Set(['http://localhost:5173/']);
  const CLIENTS = new Set(['iam-web-app', 'account-console']);
  const USER = { sub: 'mock-user-0001', username: 'testuser', password: 'Test@1234' };
  const pending = new Map();
  const codes = new Map();
  const access = new Map();
  const refresh = new Map();
  const totpSecretState = { enrolled: false, last: -1 };
  let origin;
  let issuer;

  const json = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', ...extra });
    res.end(JSON.stringify(body));
  };
  const oerr = (res, error, description, status = 400) => json(res, status, { error, error_description: description });
  const page = (res, status, html) => {
    res.writeHead(status, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><head><title>mock</title></head><body>${html}</body></html>`);
  };
  const redirectWith = (res, uri, params) => {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
    if (!has('no-iss')) u.searchParams.set('iss', issuer);
    res.writeHead(302, { location: u.href });
    res.end();
  };
  const readForm = (req) =>
    new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b))));
    });

  const metadata = () => ({
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
    jwks_uri: `${issuer}/protocol/openid-connect/certs`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  });

  async function issueTokens(entry, { withRefresh = true, oldRefresh } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const at = rnd();
    access.set(at, { sub: entry.sub, exp: now + 300 });
    const claims = { sub: entry.sub, azp: entry.clientId, at_hash: b64url(createHash('sha256').update(at).digest().subarray(0, 16)) };
    if (entry.nonce && !has('no-nonce')) claims.nonce = entry.nonce;
    const idToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-key-1', typ: 'JWT' })
      .setIssuer(has('wrong-iss') ? issuer + '/x' : issuer)
      .setAudience(entry.clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
    const out = { access_token: at, token_type: 'Bearer', expires_in: 300, id_token: idToken, scope: 'openid' };
    if (withRefresh) {
      let rt = oldRefresh && has('no-rotate') ? oldRefresh : rnd();
      refresh.set(rt, { ...entry, family: entry.family ?? rnd(), live: true });
      out.refresh_token = rt;
    }
    return out;
  }

  const finish = (res, q) => {
    const code = rnd();
    codes.set(code, { clientId: q.client_id, redirectUri: q.redirect_uri, challenge: q.code_challenge, nonce: q.nonce, sub: USER.sub, used: false });
    return redirectWith(res, q.redirect_uri, { code, state: has('no-state') ? undefined : q.state });
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, origin);
    const p = u.pathname.replace(/^\/realms\/iam-platform/, '');
    try {
      if (p === '/.well-known/openid-configuration' || p === '/.well-known/oauth-authorization-server') return json(res, 200, metadata());
      if (p === '/protocol/openid-connect/certs') return json(res, 200, { keys: [jwk] });

      if (p === '/protocol/openid-connect/auth' && req.method === 'GET') {
        const q = Object.fromEntries(u.searchParams);
        if (!CLIENTS.has(q.client_id)) return page(res, 400, 'Invalid client');
        if (!REGISTERED.has(q.redirect_uri) && !has('open-redirect')) return page(res, 400, 'Invalid parameter: redirect_uri');
        const fail = (error) => redirectWith(res, q.redirect_uri, { error, state: has('no-state') ? undefined : q.state });
        if (q.response_type !== 'code') return fail('unsupported_response_type');
        if (!has('no-pkce')) {
          if (!q.code_challenge) return fail('invalid_request');
          if (q.code_challenge_method !== 'S256') return fail('invalid_request');
        }
        if (q.prompt === 'none') return fail('login_required');
        const id = rnd();
        pending.set(id, q);
        return page(
          res,
          200,
          `<form id="kc-form-login" method="post" action="${origin}/realms/iam-platform/login-actions/authenticate?session_code=${id}&amp;x=1">` +
            '<input type="hidden" name="credentialId" value=""/><input name="username"/><input type="password" name="password"/></form>',
        );
      }

      if (p === '/login-actions/authenticate' && req.method === 'POST') {
        const q = pending.get(u.searchParams.get('session_code'));
        const f = await readForm(req);
        if (!q) return page(res, 400, 'expired');
        if (f.username !== USER.username || f.password !== USER.password) {
          return page(res, 200, '<p>Invalid username or password.</p><form method="post" action="?session_code=' + u.searchParams.get('session_code') + '"><input name="username"/><input type="password" name="password"/></form>');
        }
        if (has('totp-enroll')) {
          const sc = u.searchParams.get('session_code');
          if (!q.otpDone) {
            const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
            const action = `${origin}/realms/iam-platform/login-actions/totp?session_code=${sc}`;
            q.otpDone = false;
            return page(res, 200, totpSecretState.enrolled
              ? `<form method="post" action="${action}"><input name="otp"/></form>`
              : `<span id="kc-totp-secret-key">${secret.replace(/(.{4})/g, '$1 ')}</span><form method="post" action="${action}"><input type="hidden" name="totpSecret" value="x"/><input name="totp"/><input name="userLabel"/></form>`);
          }
        }
        return finish(res, q);
      }

      if (p === '/login-actions/totp' && req.method === 'POST') {
        const q = pending.get(u.searchParams.get('session_code'));
        const f = await readForm(req);
        if (!q) return page(res, 400, 'expired');
        const secret = base32Decode('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
        const given = f.otp ?? f.totp;
        const now = Math.floor(Date.now() / 30000);
        const counter = [now - 1, now, now + 1].find((c) => hotp(secret, c) === given);
        if (counter === undefined || counter <= totpSecretState.last) return page(res, 200, '<p>Invalid authenticator code.</p>');
        totpSecretState.last = counter;
        totpSecretState.enrolled = true;
        q.otpDone = true;
        return finish(res, q);
      }

      if (p === '/protocol/openid-connect/token') {
        if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' });
        const f = await readForm(req);
        if (!f.client_id) return oerr(res, 'invalid_client', 'Missing client_id', 401);
        if (!CLIENTS.has(f.client_id)) return oerr(res, 'invalid_client', 'Invalid client', 401);
        if (f.grant_type === 'authorization_code') {
          if (!f.code) return oerr(res, 'invalid_request', 'Missing parameter: code');
          const c = codes.get(f.code);
          if (!c) return oerr(res, 'invalid_grant', 'Code not valid');
          if (c.used && !has('replay')) return oerr(res, 'invalid_grant', 'Code not valid');
          c.used = true;
          if (!has('no-binding') && (c.clientId !== f.client_id || c.redirectUri !== f.redirect_uri)) return oerr(res, 'invalid_grant', 'Incorrect binding');
          if (!has('no-pkce')) {
            if (!f.code_verifier) return oerr(res, 'invalid_grant', 'PKCE code verifier not specified');
            if (b64url(createHash('sha256').update(f.code_verifier).digest()) !== c.challenge) return oerr(res, 'invalid_grant', 'PKCE verification failed');
          }
          return json(res, 200, await issueTokens(c));
        }
        if (f.grant_type === 'refresh_token') {
          if (!f.refresh_token) return oerr(res, 'invalid_request', 'Missing parameter: refresh_token');
          const r = refresh.get(f.refresh_token);
          if (r && !r.live && !has('no-rotate')) {
            for (const v of refresh.values()) if (v.family === r.family) v.live = false; // reuse detection
          }
          if (!r || !r.live || r.clientId !== f.client_id) return oerr(res, 'invalid_grant', 'Invalid refresh token');
          if (!has('no-rotate')) {
            r.live = false;
          }
          return json(res, 200, await issueTokens(r, { oldRefresh: f.refresh_token }));
        }
        if (!f.grant_type) return oerr(res, 'invalid_request', 'Missing form parameter: grant_type');
        if (f.grant_type === 'password') return oerr(res, 'unauthorized_client', 'Client not allowed for direct access grants');
        return oerr(res, 'unsupported_grant_type', 'Unsupported grant_type');
      }

      if (p === '/protocol/openid-connect/userinfo') {
        const m = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '');
        if (!m) return json(res, 401, { error: 'invalid_request' }, { 'www-authenticate': 'Bearer realm="iam-platform"' });
        const a = access.get(m[1]);
        if ((!a || a.exp < Date.now() / 1000) && !has('userinfo-open')) {
          return json(res, 401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer realm="iam-platform", error="invalid_token"' });
        }
        return json(res, 200, { sub: a?.sub ?? USER.sub, preferred_username: USER.username });
      }
      page(res, 404, 'not found');
    } catch (e) {
      console.error('[mock] error', e);
      json(res, 500, { error: 'server_error' });
    }
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  issuer = `${origin}/realms/iam-platform`;
  return { issuer, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMock({ port: Number(process.env.MOCK_PORT ?? 8099) });
  console.log(`MOCK provider (not a real IdP) listening, issuer ${m.issuer}, bugs: ${process.env.MOCK_BUGS ?? 'none'}`);
}
