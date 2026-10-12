# ADR 0001: Upgrade Keycloak from 23.0 to the 26.x line

- Status: Accepted for local development (2026-10-07). Production upgrade is pending because there is no live server today.
- Deciders: Ananga (product owner). Drafted with Claude.

## Context
- The platform baseline (v1) runs Keycloak 23.0 (`infra/docker/docker-compose.yml`).
- Passkeys are a core Phase 1 goal. Keycloak's own announcement for passkey support is titled for release 26.4, and says passkeys are off by default and are enabled in the Webauthn Passwordless Policy.
- The production compose file runs `start-dev`, which is not a production mode. That is a separate fix tracked in Phase 5.
- There is no live server (the AWS subscription ended), so there is no production database to migrate right now. That changes the risk: the migration risk becomes real only when a host exists.

## Options
| Option | For | Against |
| --- | --- | --- |
| A. Stay on 23.0 | No change risk | No passkey support; falls further behind security fixes |
| B. Upgrade to 26.4.x (first passkey release) | Smallest jump that unlocks passkeys | Misses later fixes |
| C. Upgrade to the latest 26.x patch (chosen locally: 26.6.1) | Passkeys plus later fixes | Larger version jump to test |
| D. Replace Keycloak | Avoids Keycloak limits (for example no built-in SCIM) | Throws away the working baseline; large cost |

## Decision
Option C for local development: `docker-compose.local.yml` now runs 26.6.1. Keycloak stays the core (ADR-001 in the platform-docs repo says the same). Revisit D only if SCIM or B2B proves too awkward in Phase 3.

## Consequences
- Admin env vars changed to `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`; the old `KEYCLOAK_ADMIN*` names are deprecated in 26.x. The production compose still uses the old names until it is upgraded.
- The frontend uses `keycloak-js` ^21.1.2 against a 26.x server. This is untested; upgrade the library alongside the server if login misbehaves.
- The realm export was written for 23.0 and imported cleanly into 26.6.1 (checked 2026-10-07). Whether the `webAuthnPolicyPasswordless*` fields were applied is verified in the admin console, not by the import succeeding.

## Verification still owed
- [ ] Local login works with the PKCE public client (password).
- [ ] Passkey registration works on a Mac and a phone.
- [ ] Production upgrade: read Keycloak's upgrade guide for 23 to 26, rehearse on a copy of real data, and write the rollback step, once a host exists.
