import { test } from 'node:test';
import assert from 'node:assert/strict';
import { http } from '../lib/http.js';
import { discovery } from '../lib/oidc.js';

async function getJwks() {
  const d = await discovery();
  const r = await http(d.jwks_uri);
  assert.equal(r.status, 200, `GET ${d.jwks_uri}`);
  assert.ok(Array.isArray(r.json?.keys), 'JWKS has a "keys" array');
  return r.json.keys;
}

test('[OIDC Core 10.1, RFC 7517 5] K01: jwks_uri serves a JWK Set with at least one signature key that has kty and kid', async () => {
  const keys = await getJwks();
  const sig = keys.filter((k) => !k.use || k.use === 'sig');
  assert.ok(sig.length >= 1, 'at least one signing key');
  for (const k of sig) {
    assert.ok(k.kty, 'kty');
    assert.ok(k.kid, 'kid (needed to pick the key for an ID token)');
  }
});

test('[OIDC Core 15.1, RFC 7518 3.3] K02: an RS256 signature key is published (RS256 is the mandatory-to-implement ID token alg)', async () => {
  const keys = await getJwks();
  const rs = keys.filter((k) => k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  assert.ok(rs.length >= 1);
  for (const k of rs) assert.ok(k.n && k.e, 'RSA public components n and e');
});

test('[RFC 7517 / RFC 7518 6] K03: no private key material is exposed in the JWKS', async () => {
  const keys = await getJwks();
  for (const k of keys) {
    for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k']) {
      assert.equal(k[priv], undefined, `key ${k.kid} leaks private parameter "${priv}"`);
    }
  }
});

test('[RFC 7517 4.5] K04: kid values are unique within the JWKS', async () => {
  const keys = await getJwks();
  const kids = keys.map((k) => k.kid).filter(Boolean);
  assert.equal(new Set(kids).size, kids.length);
});
