import Keycloak from 'keycloak-js';

const keycloak = new Keycloak({
  url: 'https://keycloak.3.25.125.195.sslip.io',
  realm: 'iam-platform',
  clientId: 'iam-web-app',
});

export default keycloak;
