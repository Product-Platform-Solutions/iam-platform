import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/config.js';
import { describeAuthOutcome, pkcePair, rawAuthorize, login, LoginFailed, LoginBlocked } from '../lib/oidc.js';

// None of these tests needs a successful login: they check what the authorization endpoint
// refuses to do. "Rejected" means: no code or token issued, and no login form presented.

function assertRefused(r, why) {
  const o = describeAuthOutcome(r);
  assert.notEqual(o.kind, 'login-form', `${why}: provider presented a login form, i.e. it accepted the request`);
  if (o.kind === 'redirect') {
    assert.ok(o.error, `${why}: redirected without an error parameter (${o.url})`);
    assert.equal(o.code, null, `${why}: authorization code was issued`);
    assert.equal(o.token, null, `${why}: token was issued`);
  } else {
    assert.ok(r.status >= 400, `${why}: expected an error page (HTTP >= 400), got HTTP ${r.status}`);
  }
  return o;
}

const EVIL = 'https://evil.example.invalid/callback';

test('[RFC 6749 3.1.2.4, OIDC Core 3.1.2.6] A01: unregistered redirect_uri is rejected and the user agent is NOT redirected to it', async () => {
  const r = await rawAuthorize({ redirect_uri: EVIL });
  const o = describeAuthOutcome(r);
  if (o.kind === 'redirect') assert.ok(!o.url.startsWith(EVIL), `redirected to attacker-controlled URI: ${o.url}`);
  assertRefused(r, 'unregistered redirect_uri');
  assert.equal(o.kind, 'page', 'an invalid redirect_uri must be reported to the user, not via redirect');
});

test('[RFC 6749 3.1.2.3, RFC 9700 4.1.3] A02: look-alike host (registered host as a prefix of another host) is rejected', async () => {
  const u = new URL(config.redirectUri);
  const lookalike = `${u.protocol}//${u.host}.evil.example.invalid${u.pathname}`;
  const r = await rawAuthorize({ redirect_uri: lookalike });
  const o = describeAuthOutcome(r);
  if (o.kind === 'redirect') assert.ok(!o.url.startsWith(lookalike), `redirected to look-alike URI: ${o.url}`);
  assertRefused(r, 'look-alike redirect_uri');
});

test('[RFC 6749 3.1.2.3] A03: redirect_uri with a different scheme/port than registered is rejected', async () => {
  const u = new URL(config.redirectUri);
  const other = `${u.protocol}//${u.hostname}:${Number(u.port || 80) + 4242}${u.pathname}`;
  const r = await rawAuthorize({ redirect_uri: other });
  const o = describeAuthOutcome(r);
  if (o.kind === 'redirect') assert.ok(!o.url.startsWith(other), `redirected to unregistered port: ${o.url}`);
  assertRefused(r, 'different port');
});

test('[RFC 6749 4.1.2.1] A04: unknown client_id is rejected and not redirected', async () => {
  const r = await rawAuthorize({ client_id: 'no-such-client-' + Date.now() });
  assert.equal(describeAuthOutcome(r).kind, 'page', 'unknown client must not trigger a redirect');
  assertRefused(r, 'unknown client_id');
});

test('[RFC 7636 4.4.1, RFC 9700 2.1.1] A05: public client without PKCE (no code_challenge) is rejected', async () => {
  const r = await rawAuthorize({}, { pkce: false });
  assertRefused(r, 'authorization request without code_challenge');
});

test('[RFC 7636 4.2, RFC 9700 2.1.1] A06: code_challenge_method=plain is rejected (S256 required)', async () => {
  const { verifier } = pkcePair();
  const r = await rawAuthorize({ code_challenge: verifier, code_challenge_method: 'plain' }, { pkce: false });
  assertRefused(r, 'PKCE method plain');
});

test('[RFC 7636 4.3] A07: unsupported code_challenge_method value is rejected', async () => {
  const { challenge } = pkcePair();
  const r = await rawAuthorize({ code_challenge: challenge, code_challenge_method: 'S999' }, { pkce: false });
  assertRefused(r, 'bogus code_challenge_method');
});

test('[RFC 6749 4.1.2.1] A08: unsupported response_type is rejected', async () => {
  const r = await rawAuthorize({ response_type: 'bogus' });
  assertRefused(r, 'bogus response_type');
});

test('[OIDC Core 3.1.2.6, RFC 6749 4.1.2.1] A09: prompt=none without a session redirects with error=login_required and echoes state', async () => {
  const r = await rawAuthorize({ prompt: 'none' });
  const o = describeAuthOutcome(r);
  assert.equal(o.kind, 'redirect', `expected an error redirect, got ${JSON.stringify(o)}`);
  assert.equal(o.error, 'login_required');
  assert.equal(o.state, r.params.state, 'state is echoed on error responses');
  assert.equal(o.code, null);
});

test('[RFC 9207 2] A10: error responses that redirect carry iss equal to the issuer', async () => {
  const r = await rawAuthorize({ prompt: 'none' });
  const o = describeAuthOutcome(r);
  assert.equal(o.kind, 'redirect');
  assert.equal(o.iss, config.issuer);
});

test('[RFC 6749 10.12 / 4.1.1, OIDC Core 3.1.2.1] A11: login with a wrong password does not yield a code', async (t) => {
  try {
    await login({}, { password: 'definitely-not-the-password-' + Date.now() });
    assert.fail('login succeeded with a wrong password');
  } catch (e) {
    if (e instanceof LoginBlocked) return t.skip(`SKIPPED (precondition): ${e.message}`);
    assert.ok(e instanceof LoginFailed, `expected a rejected login, got: ${e.message}`);
  }
});

test('[RFC 9700 2.1.2, RFC 6749 4.2] A12: implicit flow (response_type=token, id_token token, id_token) is not available to this client', async () => {
  for (const response_type of ['token', 'id_token token', 'id_token']) {
    const r = await rawAuthorize({ response_type });
    assertRefused(r, `response_type=${response_type}`);
  }
});
