import assert from 'node:assert/strict';
import { LoginBlocked, loginAndTokens } from './oidc.js';

// OAuth 2.0 error response (RFC 6749 5.2): JSON body with "error", status 400 (401 allowed for invalid_client).
export function assertOAuthError(r, errors, statuses = [400]) {
  assert.ok(statuses.includes(r.status), `expected HTTP ${statuses.join('/')}, got ${r.status}: ${r.text.slice(0, 200)}`);
  assert.match(r.headers.get('content-type') ?? '', /application\/json/i, 'error response must be JSON');
  assert.ok(r.json?.error, 'error response has an "error" member');
  const allowed = [].concat(errors);
  assert.ok(allowed.includes(r.json.error), `expected error ${allowed.join(' or ')}, got "${r.json.error}"`);
  assert.equal(r.json.access_token, undefined, 'error response must not contain tokens');
}

// Runs a full interactive login once and shares the result between read-only tests.
// A missing precondition (e.g. forced TOTP setup) turns into a skip with the reason, never a silent pass.
export function sharedFlow(overrides, opts) {
  let p;
  return async function get(t) {
    p ??= loginAndTokens(overrides, opts).then(
      (v) => ({ ok: v }),
      (e) => {
        if (e instanceof LoginBlocked) return { blocked: e.message };
        return { error: e };
      },
    );
    const res = await p;
    if (res.blocked) {
      t.skip(`SKIPPED (precondition): ${res.blocked}`);
      return null;
    }
    if (res.error) throw res.error;
    return res.ok;
  };
}
