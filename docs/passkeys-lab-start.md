# Passkeys lab: start here

Written 2026-10-06 after a repo health check on `develop`.

## State of the repo
- Frontend (`apps/frontend/iam-web-app`): `npm ci`, `npm run build` and `npm run lint` all pass.
- Login is the Keycloak SSO redirect only. There is no backend yet (`apps/backend` is empty).
- Keycloak realm export: `iam/keycloak/realms/iam-platform-realm.json` (realm `iam-platform`, client `iam-web-app`, roles `app-admin` / `app-user` / `app-readonly`, one `testuser`).
- Not verified: the Keycloak container was not started during this check (no Docker daemon available), so the local login flow below is untested.

## Run it locally
1. `docker compose -f infra/docker/docker-compose.local.yml up` (Keycloak at http://localhost:8080, admin / admin).
2. `cd apps/frontend/iam-web-app && cp .env.example .env.local && npm ci && npm run dev`.
3. Open the Vite URL and log in as `testuser`.

## Things to check or fix before building
1. **Client type.** The realm export has `iam-web-app` as a confidential client (`publicClient: false`), but a browser app cannot keep a secret. If local login fails at the token step, set it to a public client with PKCE. Check this first.
2. **Keycloak version.** Production runs 23.0. Keycloak's own announcement for passkeys is titled as arriving in 26.4 (https://www.keycloak.org/2025/09/passkeys-support-26-4), so plan an upgrade as the first lab decision. That is a real PM trade-off to write up: compatibility risk against the feature.
3. **Committed secrets.** `infra/docker/docker-compose.yml` contains the database and admin passwords in plain text. Move them to environment variables and rotate them.
4. **Open redirects.** The realm allows `*` for redirect URIs and web origins. Fine locally, tighten before production.
5. **Unpinned image.** `n8nio/n8n:latest` should be pinned.
6. **CI.** `ci.yml` only checks the folder layout. Add the frontend build and lint.
7. **Dependencies.** `npm audit` reports 14 vulnerabilities (10 high).

## Suggested first lab steps (Passkeys / WebAuthn)
1. Get local login working with `testuser` (fix item 1 if needed).
2. Decide and record the Keycloak upgrade path (item 2).
3. Enable the WebAuthn passwordless policy, register a passkey for `testuser`, and match what you see against the registration-ceremony diagram from Day 1.
