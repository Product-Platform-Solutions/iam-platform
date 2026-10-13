# OIDC contract tests

Status: harness written; **never yet executed against a real Keycloak** (the authoring sandbox had no Docker). Every "Keycloak result" below is therefore "Not run yet". The first CI run, or a local run, must fill that column in. See ADR 0002 (own identity core with Keycloak as reference): these tests are the first concrete definition of "correct" it asks for. They are not the OpenID Foundation conformance suite and do not replace it.

## What this is

A provider-agnostic suite under `tests/oidc-contract/` (Node 22, built-in `node:test`, one dependency: `jose` for JWT verification). It talks to a provider only over HTTP, so the same tests run unchanged against Keycloak now and the own identity core later. Each test name starts with the spec section it checks, for example `[RFC 7636 4.6] L12: wrong code_verifier is rejected`.

## How to run

```bash
# 1. start the reference (from the repo root)
docker compose -f infra/docker/docker-compose.local.yml up -d keycloak
# wait until http://localhost:8080/realms/iam-platform/.well-known/openid-configuration answers

# 2. run
cd tests/oidc-contract
npm ci
npm test
```

Configuration (all optional; defaults target the local Keycloak):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ISSUER` | `http://localhost:8080/realms/iam-platform` | Must equal the `issuer` in the discovery document exactly |
| `CLIENT_ID` | `iam-web-app` | Client under test |
| `CLIENT_SECRET` | unset | Only for a confidential client; the intended setup is a public client with PKCE |
| `REDIRECT_URI` | `http://localhost:5173/` | A redirect URI registered for the client |
| `TEST_USER` / `TEST_PASSWORD` | `testuser` / `Test@1234` | Local test credentials from the compose file comment |
| `OTHER_CLIENT_ID` | `account-console` | A second existing client, for the "bound to its client" tests |
| `TEST_TOTP_SECRET` | unset | Base32 secret of the user's already enrolled authenticator |
| `TOTP_AUTO_ENROLL` | unset | `1` = complete a forced "configure OTP" step on first login and remember the secret in `tests/oidc-contract/.state/` (git-ignored, mode 0600, never printed) |
| `TOTP_STATE_FILE` | `.state/totp.json` | Where the enrolled secret and last used step are kept |

Other scripts: `npm run lint` (`node --check` on every file), `npm run check:docs` (every test ID is in the table below, and the reverse), `npm run test:mock` (see "Self-check with a mock").

## TOTP precondition for the full-login tests

The realm export gives `testuser` the required action `CONFIGURE_TOTP`, so the first interactive login ends on an authenticator-setup page, and later logins ask for a one-time code. Tests that need a finished login (IDs `L*`, `R*`, `U03`, `U04`) handle this in one of three ways:

1. `TOTP_AUTO_ENROLL=1` on a fresh Keycloak: the harness reads the manual-entry key from the setup page, submits the first code, stores the secret, and answers the code prompt on later logins. It spaces codes over unused 30-second steps (Keycloak rejects a reused code), so a full run takes several minutes. **This path has only been exercised against the mock, not against Keycloak's real pages**, so selectors (`kc-totp-secret-key`, `totp`, `otp`) may need adjusting after the first real run.
2. `TEST_TOTP_SECRET=<base32>` if the user is already enrolled.
3. Neither set: those tests are reported by `node:test` as **SKIPPED** with the message `SKIPPED (precondition): ...` stating the reason. A skip is not a pass. Tests that do not need a finished login (discovery, JWKS, authorization-endpoint rejections, token-endpoint negatives, userinfo U01/U02, wrong-password A11) always run.

If the login stops on any other page (another required action, consent), the same skip mechanism fires with the page title in the message.

A different, more testable option for the own core and for CI later: a dedicated test user without the TOTP required action. That needs a realm change, which is outside this task.

## Realm prerequisite

The tests assume the intended PKCE public client `iam-web-app` (S256 enforced, exact `localhost:5173/5174` redirect patterns, no direct-access grant, no implicit flow). The realm file committed at git HEAD of this branch still has the old confidential client with `redirectUris: ["*"]`; against that file A01, A03, A05, A06, A12, N08 and likely more would fail, and that would be a true finding. The PKCE public-client realm exists in the owner's working tree.

## Test table

"Keycloak result" is the column to maintain after each run: `Pass`, `Fail (reason)` or `Skipped (reason)`. The notes column holds predictions and known weak spots; predictions are not results.

| ID | Spec section | What it checks | Keycloak 26.6.1 result | Notes / prediction |
| --- | --- | --- | --- | --- |
| D01 | OIDC Discovery 4 | discovery document is served as JSON at <issuer>/.well-known/openid-configuration | Not run yet |  |
| D02 | OIDC Discovery 4.3, RFC 8414 3.3 | "issuer" in the document is identical to the configured ISSUER | Not run yet |  |
| D03 | OIDC Discovery 3 | REQUIRED metadata is present (authorization_endpoint, token_endpoint, jwks_uri, response_types_supported, subject_types_supported, id_token_signing_alg_values_supported) | Not run yet |  |
| D04 | OIDC Discovery 3 | all advertised endpoints are absolute URLs without fragment | Not run yet |  |
| D05 | OIDC Core 3.1.2.1, 5.3 | scopes_supported includes openid; userinfo_endpoint is advertised | Not run yet |  |
| D06 | RFC 6749 4.1, 6 | grant_types_supported includes authorization_code and refresh_token | Not run yet |  |
| D07 | RFC 7636 / RFC 8414 2 | code_challenge_methods_supported advertises S256 | Not run yet |  |
| D08 | RFC 9207 3 | authorization_response_iss_parameter_supported is true | Not run yet | Believed true on 26.x; unverified. |
| D09 | RFC 8414 3 | authorization server metadata is also served (<issuer>/.well-known/oauth-authorization-server or the RFC 8414 path-inserted form) with the same issuer | Not run yet | Keycloak serves the appended form; the path-inserted form probably not. Test accepts either. |
| K01 | OIDC Core 10.1, RFC 7517 5 | jwks_uri serves a JWK Set with at least one signature key that has kty and kid | Not run yet |  |
| K02 | OIDC Core 15.1, RFC 7518 3.3 | an RS256 signature key is published (RS256 is the mandatory-to-implement ID token alg) | Not run yet |  |
| K03 | RFC 7517 / RFC 7518 6 | no private key material is exposed in the JWKS | Not run yet |  |
| K04 | RFC 7517 4.5 | kid values are unique within the JWKS | Not run yet |  |
| A01 | RFC 6749 3.1.2.4, OIDC Core 3.1.2.6 | unregistered redirect_uri is rejected and the user agent is NOT redirected to it | Not run yet | Would FAIL against the realm file at git HEAD (redirectUris "*", confidential client). Expected to pass on the PKCE public-client realm in the owner working tree. |
| A02 | RFC 6749 3.1.2.3, RFC 9700 4.1.3 | look-alike host (registered host as a prefix of another host) is rejected | Not run yet | Depends on the realm not using wildcard host patterns. |
| A03 | RFC 6749 3.1.2.3 | redirect_uri with a different scheme/port than registered is rejected | Not run yet | Same prerequisite as A01. |
| A04 | RFC 6749 4.1.2.1 | unknown client_id is rejected and not redirected | Not run yet |  |
| A05 | RFC 7636 4.4.1, RFC 9700 2.1.1 | public client without PKCE (no code_challenge) is rejected | Not run yet | Needs client attribute pkce.code.challenge.method=S256 (in the working-tree realm, not at git HEAD). |
| A06 | RFC 7636 4.2, RFC 9700 2.1.1 | code_challenge_method=plain is rejected (S256 required) | Not run yet | Same prerequisite as A05. |
| A07 | RFC 7636 4.3 | unsupported code_challenge_method value is rejected | Not run yet | Unverified. |
| A08 | RFC 6749 4.1.2.1 | unsupported response_type is rejected | Not run yet |  |
| A09 | OIDC Core 3.1.2.6, RFC 6749 4.1.2.1 | prompt=none without a session redirects with error=login_required and echoes state | Not run yet |  |
| A10 | RFC 9207 2 | error responses that redirect carry iss equal to the issuer | Not run yet | Depends on Keycloak adding iss to error redirects; unverified. |
| A11 | RFC 6749 10.12 / 4.1.1, OIDC Core 3.1.2.1 | login with a wrong password does not yield a code | Not run yet | Does not need TOTP (fails at the password step). |
| A12 | RFC 9700 2.1.2, RFC 6749 4.2 | implicit flow (response_type=token, id_token token, id_token) is not available to this client | Not run yet | Needs implicit flow disabled on the client. |
| L01 | RFC 6749 4.1.2 | state is returned unchanged in the authorization response | Not run yet |  |
| L02 | RFC 9207 2 | authorization response carries iss equal to the issuer | Not run yet |  |
| L03 | RFC 6749 5.1 | token response has access_token, token_type=Bearer, expires_in, and is not cacheable | Not run yet |  |
| L04 | OIDC Core 3.1.3.7, 2 | ID token signature verifies against the JWKS; iss, aud, exp are valid; alg is in the advertised list and not "none" | Not run yet |  |
| L05 | OIDC Core 2, 3.1.3.7 | ID token claims: iss, sub, aud, exp, iat present and consistent; azp equals client_id when aud has several values | Not run yet |  |
| L06 | OIDC Core 3.1.2.1, 3.1.3.7 step 11 | nonce from the authorization request is returned unchanged in the ID token | Not run yet |  |
| L07 | OIDC Core 3.1.3.6 | if at_hash is present it matches the access token (left half of SHA-256, base64url) | Not run yet | Skips itself if at_hash is absent. |
| L08 | OIDC Core 2, 5.7 | sub is stable for the same user across two separate logins | Not run yet |  |
| L09 | RFC 6749 4.1.2, 10.5 | an authorization code can be used only once (replay is rejected with invalid_grant) | Not run yet |  |
| L10 | RFC 6749 4.1.3 | authorization code is bound to the redirect_uri of the authorization request | Not run yet |  |
| L11 | RFC 6749 4.1.3, 10.5 | authorization code is bound to the client it was issued to | Not run yet | Weak: also passes on invalid_client if OTHER_CLIENT_ID does not exist. |
| L12 | RFC 7636 4.6 | wrong code_verifier is rejected with invalid_grant | Not run yet |  |
| L13 | RFC 7636 4.6 | missing code_verifier is rejected when the authorization request used a code_challenge | Not run yet | Unverified error code; accepts invalid_grant or invalid_request. |
| L14 | RFC 6749 5.1 | successful token response is sent with Cache-Control: no-store and Pragma: no-cache | Not run yet |  |
| N01 | RFC 6749 4.1.3, 5.2 | a made-up authorization code is rejected with invalid_grant | Not run yet |  |
| N02 | RFC 6749 3.2 | the token endpoint does not serve GET | Not run yet |  |
| N03 | RFC 6749 5.2 | unknown grant_type is rejected with unsupported_grant_type | Not run yet |  |
| N04 | RFC 6749 5.2 | missing grant_type is rejected with invalid_request | Not run yet |  |
| N05 | RFC 6749 4.1.3, 5.2 | authorization_code grant without code is rejected with invalid_request | Not run yet | Unverified error code; accepts invalid_request or invalid_grant. |
| N06 | RFC 6749 3.2.1, 5.2 | unknown client_id is rejected with invalid_client | Not run yet |  |
| N07 | RFC 6749 3.2.1, 5.2 | request with no client identification at all is rejected | Not run yet | Unverified. |
| N08 | RFC 9700 2.4 | resource owner password credentials grant is not available to this client | Not run yet | Needs direct access grants disabled on the client (true in the working-tree realm, not at git HEAD). |
| N09 | RFC 6749 5.2 | error responses carry no-store and (if present) error_description is a string | Not run yet | Unverified. |
| N10 | RFC 6749 6, 5.2 | a made-up refresh_token is rejected with invalid_grant | Not run yet |  |
| N11 | RFC 6749 6 | refresh_token grant without refresh_token is rejected with invalid_request | Not run yet |  |
| N12 | RFC 6749 2.3, 3.2.1 | a bogus code sent with a bogus client_secret yields an error and no tokens | Not run yet | Unverified. |
| R01 | RFC 6749 6, OIDC Core 12.1 | refresh_token grant returns a new access token; any new ID token verifies and has the same sub | Not run yet |  |
| R02 | RFC 6749 6 | a scope broader than the original grant is rejected on refresh (invalid_scope) | Not run yet | Unverified; ignoring an unknown scope is accepted, granting it is not. |
| R03 | RFC 6749 6, 10.4 | a refresh token is bound to its client | Not run yet | Weak: also passes on invalid_client if OTHER_CLIENT_ID does not exist. |
| R04 | RFC 9700 4.14.2 | public-client refresh tokens are rotated: the superseded token stops working | Not run yet | Prediction, not a result: likely FAILS on default Keycloak (refresh token revocation is off by default). |
| R05 | RFC 9700 4.14.2 | replaying a rotated-out refresh token also invalidates the newer token of that chain (reuse detection) | Not run yet | Same as R04: likely fails unless "Revoke Refresh Token" is enabled on the client. |
| U01 | OIDC Core 5.3.1, RFC 6750 3.1 | userinfo without an access token is rejected with 401 and a Bearer challenge | Not run yet |  |
| U02 | RFC 6750 3.1 | userinfo with an invalid access token is rejected with 401 invalid_token | Not run yet |  |
| U03 | OIDC Core 5.3.2 | userinfo with a valid access token returns JSON whose sub equals the ID token sub | Not run yet |  |
| U04 | RFC 6750 3.1, OIDC Core 5.3.3 | userinfo rejects a tampered access token | Not run yet |  |


## Self-check with a mock (harness validation only)

`npm run test:mock` starts `mock/mock-provider.js`, a tiny in-memory fake OpenID provider that exists only so the harness can be tested in a sandbox. It is **not** an identity provider and says nothing about Keycloak. Results at authoring time:

- Clean mock: 60 of 60 pass.
- With `MOCK_BUGS=totp-enroll` and `TOTP_AUTO_ENROLL=1`: 60 of 60 pass (about 5 minutes, because of TOTP step spacing). Without auto-enrol, 21 login-dependent tests skip with the reason and the rest pass.
- Mutation check: each injected defect (`open-redirect`, `no-pkce`, `replay`, `no-state`, `no-nonce`, `no-binding`, `wrong-iss`, `no-rotate`, `userinfo-open`, `no-iss`) made at least one test fail, so those tests can fail.

## Pointing the tests at the own core

1. Implement the same endpoints and an HTML login form with a `password` input (the harness submits the first form that contains one, with its hidden fields).
2. Set `ISSUER` to the own core's issuer (must match its discovery document byte for byte), and register `CLIENT_ID`, `REDIRECT_URI`, a test user, and ideally a second client for `OTHER_CLIENT_ID`.
3. Run `npm test`. No test file needs to change. If a test fails because of a provider quirk rather than a spec rule, change the test (or its notes), not the provider, and record why.
4. Retirement criterion 2 in ADR 0002 also names brute force and token confusion; those are **not covered yet** here, nor are logout, introspection/revocation, passkeys, TOTP as a login method, or token expiry. They are follow-ups.

## Known limits

- Spec section numbers come from the author's reading and have not been re-checked by a second person.
- Several error-code expectations (for example `invalid_request` for a missing parameter) follow RFC 6749 strictly and may differ from Keycloak's actual choice. The first real run decides, and each such case should then be either fixed in the test (if the spec allows both) or recorded as a Keycloak deviation.
- Cookies are not scoped by path or domain; one origin only.
