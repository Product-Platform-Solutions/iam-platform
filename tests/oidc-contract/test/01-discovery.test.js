import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, discoveryUrl } from '../lib/config.js';
import { http } from '../lib/http.js';
import { discovery } from '../lib/oidc.js';

test('[OIDC Discovery 4] D01: discovery document is served as JSON at <issuer>/.well-known/openid-configuration', async () => {
  const r = await http(discoveryUrl());
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /application\/json/i);
  assert.ok(r.json && typeof r.json === 'object', 'body is a JSON object');
});

test('[OIDC Discovery 4.3, RFC 8414 3.3] D02: "issuer" in the document is identical to the configured ISSUER', async () => {
  const d = await discovery();
  assert.equal(d.issuer, config.issuer);
});

test('[OIDC Discovery 3] D03: REQUIRED metadata is present (authorization_endpoint, token_endpoint, jwks_uri, response_types_supported, subject_types_supported, id_token_signing_alg_values_supported)', async () => {
  const d = await discovery();
  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri', 'response_types_supported', 'subject_types_supported', 'id_token_signing_alg_values_supported']) {
    assert.ok(d[k] !== undefined && d[k] !== null, `missing ${k}`);
  }
  assert.ok(d.response_types_supported.includes('code'), 'response_types_supported includes "code"');
  assert.ok(d.id_token_signing_alg_values_supported.includes('RS256'), 'RS256 MUST be supported (OIDC Core 15.1)');
  assert.ok(!d.id_token_signing_alg_values_supported.includes('none'), '"none" must not be offered for the code flow ID token');
});

test('[OIDC Discovery 3] D04: all advertised endpoints are absolute URLs without fragment', async () => {
  const d = await discovery();
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint']) {
    assert.ok(d[k], `${k} is advertised`);
    const u = new URL(d[k]);
    assert.ok(['http:', 'https:'].includes(u.protocol), `${k} protocol`);
    assert.equal(u.hash, '', `${k} has no fragment`);
  }
});

test('[OIDC Core 3.1.2.1, 5.3] D05: scopes_supported includes openid; userinfo_endpoint is advertised', async () => {
  const d = await discovery();
  assert.ok(d.scopes_supported?.includes('openid'));
  assert.ok(d.userinfo_endpoint);
});

test('[RFC 6749 4.1, 6] D06: grant_types_supported includes authorization_code and refresh_token', async () => {
  const d = await discovery();
  assert.ok(d.grant_types_supported?.includes('authorization_code'));
  assert.ok(d.grant_types_supported?.includes('refresh_token'));
});

test('[RFC 7636 / RFC 8414 2] D07: code_challenge_methods_supported advertises S256', async () => {
  const d = await discovery();
  assert.ok(d.code_challenge_methods_supported?.includes('S256'));
});

test('[RFC 9207 3] D08: authorization_response_iss_parameter_supported is true', async () => {
  const d = await discovery();
  assert.equal(d.authorization_response_iss_parameter_supported, true);
});

test('[RFC 8414 3] D09: authorization server metadata is also served (<issuer>/.well-known/oauth-authorization-server or the RFC 8414 path-inserted form) with the same issuer', async () => {
  const u = new URL(config.issuer);
  const candidates = [
    discoveryUrl('oauth-authorization-server'), // appended form (what Keycloak serves)
    `${u.origin}/.well-known/oauth-authorization-server${u.pathname.replace(/\/+$/, '')}`, // RFC 8414 3.1 inserted form
  ];
  const tried = [];
  for (const c of candidates) {
    const r = await http(c);
    tried.push(`${c} -> ${r.status}`);
    if (r.status === 200 && r.json?.issuer === config.issuer) return;
  }
  assert.fail(`no RFC 8414 metadata document with matching issuer. Tried: ${tried.join('; ')}`);
});
