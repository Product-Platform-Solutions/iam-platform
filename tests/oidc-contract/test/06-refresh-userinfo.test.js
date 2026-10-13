import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/config.js';
import { decodeJwtPart, loginAndTokens, LoginBlocked, tokenRequest, userinfo, verifyIdToken } from '../lib/oidc.js';
import { assertOAuthError, sharedFlow } from '../lib/assertions.js';

// Needs an interactive login (see docs/testing/oidc-contract-tests.md, "TOTP precondition").
// Tests that consume a refresh token take their own login; read-only userinfo checks share one.

async function freshTokens(t) {
  try {
    return await loginAndTokens();
  } catch (e) {
    if (e instanceof LoginBlocked) {
      t.skip(`SKIPPED (precondition): ${e.message}`);
      return null;
    }
    throw e;
  }
}

const refresh = (rt, extra = {}, opts) => tokenRequest({ grant_type: 'refresh_token', refresh_token: rt, ...extra }, opts);

test('[RFC 6749 6, OIDC Core 12.1] R01: refresh_token grant returns a new access token; any new ID token verifies and has the same sub', async (t) => {
  const f = await freshTokens(t);
  if (!f) return;
  assert.ok(f.tokens.refresh_token, 'initial token response contains a refresh_token');
  const r = await refresh(f.tokens.refresh_token);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.ok(r.json.access_token);
  assert.notEqual(r.json.access_token, f.tokens.access_token, 'a new access token is issued');
  assert.equal(String(r.json.token_type).toLowerCase(), 'bearer');
  if (r.json.id_token) {
    const { payload } = await verifyIdToken(r.json.id_token);
    assert.equal(payload.sub, decodeJwtPart(f.tokens.id_token, 1).sub);
    assert.equal(payload.iss, decodeJwtPart(f.tokens.id_token, 1).iss);
    if (payload.auth_time !== undefined) assert.equal(payload.auth_time, decodeJwtPart(f.tokens.id_token, 1).auth_time, 'auth_time unchanged on refresh (OIDC Core 12.2)');
  }
});

test('[RFC 6749 6] R02: a scope broader than the original grant is rejected on refresh (invalid_scope)', async (t) => {
  const f = await freshTokens(t);
  if (!f) return;
  const r = await refresh(f.tokens.refresh_token, { scope: 'openid urn:example:never-granted-scope-' + Date.now() });
  // Providers either reject (invalid_scope) or ignore unknown scopes; ignoring is only acceptable if the
  // returned scope does not contain the made-up one.
  if (r.status === 200) assert.ok(!String(r.json.scope ?? '').includes('never-granted-scope'), 'unknown scope was granted');
  else assertOAuthError(r, 'invalid_scope');
});

test('[RFC 6749 6, 10.4] R03: a refresh token is bound to its client', async (t) => {
  const f = await freshTokens(t);
  if (!f) return;
  // WEAK CHECK: if OTHER_CLIENT_ID does not exist the provider answers invalid_client, which also passes.
  const r = await refresh(f.tokens.refresh_token, {}, { clientId: config.otherClientId });
  assertOAuthError(r, ['invalid_grant', 'invalid_client', 'unauthorized_client'], [400, 401]);
});

test('[RFC 9700 4.14.2] R04: public-client refresh tokens are rotated: the superseded token stops working', async (t) => {
  const f = await freshTokens(t);
  if (!f) return;
  const old = f.tokens.refresh_token;
  const r1 = await refresh(old);
  assert.equal(r1.status, 200, r1.text.slice(0, 200));
  assert.ok(r1.json.refresh_token, 'rotation requires a new refresh_token in the response');
  assert.notEqual(r1.json.refresh_token, old, 'a new refresh token is issued on use (same token returned = no rotation)');
  const replay = await refresh(old);
  assertOAuthError(replay, 'invalid_grant');
});

test('[RFC 9700 4.14.2] R05: replaying a rotated-out refresh token also invalidates the newer token of that chain (reuse detection)', async (t) => {
  const f = await freshTokens(t);
  if (!f) return;
  const old = f.tokens.refresh_token;
  const r1 = await refresh(old);
  assert.equal(r1.status, 200, r1.text.slice(0, 200));
  assert.ok(r1.json.refresh_token && r1.json.refresh_token !== old, 'provider does not rotate refresh tokens (see R04)');
  await refresh(old); // replay of the superseded token, expected to fail and trigger revocation
  const later = await refresh(r1.json.refresh_token);
  assertOAuthError(later, 'invalid_grant');
});

const ui = sharedFlow();

test('[OIDC Core 5.3.1, RFC 6750 3.1] U01: userinfo without an access token is rejected with 401 and a Bearer challenge', async () => {
  const r = await userinfo(undefined);
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') ?? '', /^bearer/i);
});

test('[RFC 6750 3.1] U02: userinfo with an invalid access token is rejected with 401 invalid_token', async () => {
  const r = await userinfo('not-a-valid-token');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') ?? '', /bearer/i);
  assert.match(r.headers.get('www-authenticate') ?? '', /invalid_token/);
});

test('[OIDC Core 5.3.2] U03: userinfo with a valid access token returns JSON whose sub equals the ID token sub', async (t) => {
  const f = await ui(t);
  if (!f) return;
  const r = await userinfo(f.tokens.access_token);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.headers.get('content-type') ?? '', /application\/json/i);
  assert.equal(r.json.sub, decodeJwtPart(f.tokens.id_token, 1).sub);
});

test('[RFC 6750 3.1, OIDC Core 5.3.3] U04: userinfo rejects a tampered access token', async (t) => {
  const f = await ui(t);
  if (!f) return;
  const at = f.tokens.access_token;
  const tampered = at.slice(0, -4) + (at.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  const r = await userinfo(tampered);
  assert.equal(r.status, 401);
});
