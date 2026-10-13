import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { config } from '../lib/config.js';
import { codeExchange, decodeJwtPart, discovery, tokenRequest, tryLogin, verifyIdToken, b64url } from '../lib/oidc.js';
import { assertOAuthError, sharedFlow } from '../lib/assertions.js';

// Precondition for everything in this file: an interactive login as TEST_USER must be able to finish
// (see docs/testing/oidc-contract-tests.md, "TOTP precondition"). Otherwise each test is SKIPPED with the reason.

const flow = sharedFlow(); // one login shared by the read-only checks below

test('[RFC 6749 4.1.2] L01: state is returned unchanged in the authorization response', async (t) => {
  const f = await flow(t);
  if (!f) return;
  assert.equal(f.state, f.params.state);
});

test('[RFC 9207 2] L02: authorization response carries iss equal to the issuer', async (t) => {
  const f = await flow(t);
  if (!f) return;
  assert.equal(f.iss, config.issuer);
});

test('[RFC 6749 5.1] L03: token response has access_token, token_type=Bearer, expires_in, and is not cacheable', async (t) => {
  const f = await flow(t);
  if (!f) return;
  const r = f.tokens;
  assert.ok(typeof r.access_token === 'string' && r.access_token.length > 0);
  assert.equal(String(r.token_type).toLowerCase(), 'bearer');
  assert.ok(Number.isFinite(Number(r.expires_in)) && Number(r.expires_in) > 0, 'expires_in');
  // Cache headers are checked in L14 (they are response headers of a fresh exchange).
});

test('[OIDC Core 3.1.3.7, 2] L04: ID token signature verifies against the JWKS; iss, aud, exp are valid; alg is in the advertised list and not "none"', async (t) => {
  const f = await flow(t);
  if (!f) return;
  assert.ok(f.tokens.id_token, 'id_token is issued for scope openid');
  const { header } = await verifyIdToken(f.tokens.id_token);
  assert.notEqual(String(header.alg).toLowerCase(), 'none');
  assert.ok(header.kid, 'kid header present');
});

test('[OIDC Core 2, 3.1.3.7] L05: ID token claims: iss, sub, aud, exp, iat present and consistent; azp equals client_id when aud has several values', async (t) => {
  const f = await flow(t);
  if (!f) return;
  const { payload: p } = await verifyIdToken(f.tokens.id_token);
  const d = await discovery();
  assert.equal(p.iss, d.issuer);
  assert.ok(typeof p.sub === 'string' && p.sub.length > 0 && p.sub.length <= 255, 'sub: non-empty string, max 255 chars');
  assert.match(p.sub, /^[\x20-\x7e]+$/, 'sub is ASCII (OIDC Core 2)');
  const aud = [].concat(p.aud);
  assert.ok(aud.includes(config.clientId), 'aud contains client_id');
  if (aud.length > 1) assert.equal(p.azp, config.clientId, 'azp required when aud has multiple values');
  const now = Math.floor(Date.now() / 1000);
  assert.ok(Number.isInteger(p.exp) && p.exp > now, 'exp in the future');
  assert.ok(Number.isInteger(p.iat) && p.iat <= now + 60, 'iat not in the future');
  assert.ok(p.exp > p.iat, 'exp after iat');
});

test('[OIDC Core 3.1.2.1, 3.1.3.7 step 11] L06: nonce from the authorization request is returned unchanged in the ID token', async (t) => {
  const f = await flow(t);
  if (!f) return;
  const { payload } = await verifyIdToken(f.tokens.id_token, { nonce: f.params.nonce });
  assert.equal(payload.nonce, f.params.nonce);
});

test('[OIDC Core 3.1.3.6] L07: if at_hash is present it matches the access token (left half of SHA-256, base64url)', async (t) => {
  const f = await flow(t);
  if (!f) return;
  const { payload, header } = await verifyIdToken(f.tokens.id_token);
  if (payload.at_hash === undefined) return t.skip('provider does not include at_hash (optional for the code flow)');
  assert.equal(header.alg, 'RS256', 'this check assumes SHA-256 (RS256)');
  const digest = createHash('sha256').update(f.tokens.access_token).digest();
  assert.equal(payload.at_hash, b64url(digest.subarray(0, digest.length / 2)));
});

test('[OIDC Core 2, 5.7] L08: sub is stable for the same user across two separate logins', async (t) => {
  const a = await flow(t);
  if (!a) return;
  const b = await tryLogin(t);
  if (!b) return;
  const r = await codeExchange(b);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  const sa = decodeJwtPart(a.tokens.id_token, 1).sub;
  const sb = decodeJwtPart(r.json.id_token, 1).sub;
  assert.equal(sb, sa);
});

test('[RFC 6749 4.1.2, 10.5] L09: an authorization code can be used only once (replay is rejected with invalid_grant)', async (t) => {
  const l = await tryLogin(t);
  if (!l) return;
  const first = await codeExchange(l);
  assert.equal(first.status, 200, `first exchange should succeed: ${first.text.slice(0, 200)}`);
  const second = await codeExchange(l);
  assertOAuthError(second, 'invalid_grant');
});

test('[RFC 6749 4.1.3] L10: authorization code is bound to the redirect_uri of the authorization request', async (t) => {
  const l = await tryLogin(t);
  if (!l) return;
  const r = await codeExchange(l, { redirect_uri: config.redirectUri.replace(/\/?$/, '/') + 'other-path' });
  assertOAuthError(r, 'invalid_grant');
});

test('[RFC 6749 4.1.3, 10.5] L11: authorization code is bound to the client it was issued to', async (t) => {
  const l = await tryLogin(t);
  if (!l) return;
  // WEAK CHECK: if OTHER_CLIENT_ID does not exist the provider answers invalid_client, which also passes.
  const r = await tokenRequest(
    { grant_type: 'authorization_code', code: l.code, redirect_uri: l.params.redirect_uri, code_verifier: l.verifier },
    { clientId: config.otherClientId },
  );
  assertOAuthError(r, ['invalid_grant', 'invalid_client', 'unauthorized_client'], [400, 401]);
});

test('[RFC 7636 4.6] L12: wrong code_verifier is rejected with invalid_grant', async (t) => {
  const l = await tryLogin(t);
  if (!l) return;
  const r = await codeExchange(l, { code_verifier: 'x'.repeat(64) });
  assertOAuthError(r, 'invalid_grant');
});

test('[RFC 7636 4.6] L13: missing code_verifier is rejected when the authorization request used a code_challenge', async (t) => {
  const l = await tryLogin(t);
  if (!l) return;
  const r = await codeExchange(l, { code_verifier: undefined });
  assertOAuthError(r, ['invalid_grant', 'invalid_request']);
});

test('[RFC 6749 5.1] L14: successful token response is sent with Cache-Control: no-store and Pragma: no-cache', async (t) => {
  const l = await tryLogin(t);
  if (!l) return;
  const r = await codeExchange(l);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.headers.get('cache-control') ?? '', /no-store/i);
  assert.match(r.headers.get('pragma') ?? '', /no-cache/i);
});
