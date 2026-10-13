// Target configuration. Everything is an env var so the same tests run unchanged
// against Keycloak (reference) and, later, the own identity core.
// Secrets (TEST_PASSWORD, CLIENT_SECRET, TEST_TOTP_SECRET) are read here and never logged.

const env = process.env;

export const config = {
  // Must equal the "issuer" value of the discovery document byte for byte (no trailing slash added/removed
  // by us except one trailing slash trimmed for URL joining; see discoveryUrl()).
  issuer: env.ISSUER ?? 'http://localhost:8080/realms/iam-platform',
  clientId: env.CLIENT_ID ?? 'iam-web-app',
  // Optional. Leave unset for a public client (the intended setup for the SPA).
  clientSecret: env.CLIENT_SECRET || undefined,
  redirectUri: env.REDIRECT_URI ?? 'http://localhost:5173/',
  user: env.TEST_USER ?? 'testuser',
  password: env.TEST_PASSWORD ?? 'Test@1234',
  // A second client that exists on the provider, used for "code/refresh token is bound to its client" tests.
  // Keycloak ships the public client "account-console" in every realm. If the other client does not exist
  // the provider answers invalid_client, which still satisfies the assertion (documented as a weak check).
  otherClientId: env.OTHER_CLIENT_ID ?? 'account-console',
  scope: env.SCOPE ?? 'openid',
  // TOTP handling, see lib/totp.js. Both optional.
  totpSecret: env.TEST_TOTP_SECRET || undefined, // base32 secret of an already enrolled authenticator
  autoEnroll: env.TOTP_AUTO_ENROLL === '1',      // complete a required "configure OTP" step on first login
  stateFile: env.TOTP_STATE_FILE ?? new URL('../.state/totp.json', import.meta.url).pathname,
  httpTimeoutMs: Number(env.HTTP_TIMEOUT_MS ?? 20000),
};

export function discoveryUrl(suffix = 'openid-configuration') {
  return `${config.issuer.replace(/\/+$/, '')}/.well-known/${suffix}`;
}
