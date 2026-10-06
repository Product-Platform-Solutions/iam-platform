import Keycloak from 'keycloak-js';

// Defaults to the live server; override locally with VITE_KEYCLOAK_URL
// (see .env.example) to develop against a local Keycloak.
const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'https://keycloak.3.25.125.195.sslip.io',
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? 'iam-platform',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'iam-web-app',
});

export default keycloak;
