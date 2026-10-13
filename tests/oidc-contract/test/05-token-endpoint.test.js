import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/config.js';
import { http } from '../lib/http.js';
import { discovery, rand, tokenRequest } from '../lib/oidc.js';
import { assertOAuthError } from '../lib/assertions.js';

// Token endpoint negative cases. No login needed: every request is invalid on purpose.

const authzCode = (extra = {}) => ({
  grant_type: 'authorization_code',
  code: rand(32),
  redirect_uri: config.redirectUri,
  code_verifier: rand(48),
  ...extra,
});

test('[RFC 6749 4.1.3, 5.2] N01: a made-up authorization code is rejected with invalid_grant', async () => {
  assertOAuthError(await tokenRequest(authzCode()), 'invalid_grant');
});

test('[RFC 6749 3.2] N02: the token endpoint does not serve GET', async () => {
  const d = await discovery();
  const r = await http(`${d.token_endpoint}?${new URLSearchParams(authzCode({ client_id: config.clientId }))}`);
  assert.ok(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`);
  assert.equal(r.json?.access_token, undefined);
});

test('[RFC 6749 5.2] N03: unknown grant_type is rejected with unsupported_grant_type', async () => {
  assertOAuthError(await tokenRequest({ grant_type: 'urn:example:bogus' }), 'unsupported_grant_type');
});

test('[RFC 6749 5.2] N04: missing grant_type is rejected with invalid_request', async () => {
  assertOAuthError(await tokenRequest({ code: rand(16) }), 'invalid_request');
});

test('[RFC 6749 4.1.3, 5.2] N05: authorization_code grant without code is rejected with invalid_request', async () => {
  assertOAuthError(await tokenRequest(authzCode({ code: undefined })), ['invalid_request', 'invalid_grant']);
});

test('[RFC 6749 3.2.1, 5.2] N06: unknown client_id is rejected with invalid_client', async () => {
  const r = await tokenRequest(authzCode(), { clientId: 'no-such-client-' + Date.now() });
  assertOAuthError(r, ['invalid_client', 'unauthorized_client'], [400, 401]);
});

test('[RFC 6749 3.2.1, 5.2] N07: request with no client identification at all is rejected', async () => {
  const r = await tokenRequest(authzCode(), { auth: false });
  assertOAuthError(r, ['invalid_client', 'invalid_request'], [400, 401]);
});

test('[RFC 9700 2.4] N08: resource owner password credentials grant is not available to this client', async () => {
  const r = await tokenRequest({ grant_type: 'password', username: config.user, password: config.password, scope: config.scope });
  assertOAuthError(r, ['unauthorized_client', 'unsupported_grant_type', 'invalid_grant'], [400, 401]);
  assert.equal(r.json.access_token, undefined);
});

test('[RFC 6749 5.2] N09: error responses carry no-store and (if present) error_description is a string', async () => {
  const r = await tokenRequest(authzCode());
  assert.match(r.headers.get('cache-control') ?? '', /no-store/i);
  if (r.json.error_description !== undefined) assert.equal(typeof r.json.error_description, 'string');
});

test('[RFC 6749 6, 5.2] N10: a made-up refresh_token is rejected with invalid_grant', async () => {
  assertOAuthError(await tokenRequest({ grant_type: 'refresh_token', refresh_token: rand(48) }), 'invalid_grant');
});

test('[RFC 6749 6] N11: refresh_token grant without refresh_token is rejected with invalid_request', async () => {
  assertOAuthError(await tokenRequest({ grant_type: 'refresh_token' }), 'invalid_request');
});

test('[RFC 6749 2.3, 3.2.1] N12: a bogus code sent with a bogus client_secret yields an error and no tokens', async () => {
  const r = await tokenRequest(authzCode({ client_secret: 'wrong-secret' }));
  assert.ok(r.status >= 400, `expected an error, got HTTP ${r.status}`);
  assert.equal(r.json?.access_token, undefined);
});
