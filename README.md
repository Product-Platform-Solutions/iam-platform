# IAM Platform

Enterprise-grade Identity & Access Management built entirely on open source. Zero cost.

## Quick start (local)
You need Docker Desktop (or Docker with Compose) and Git. Nothing else, and no accounts.

```
git clone https://github.com/Product-Platform-Solutions/iam-platform.git
cd iam-platform
docker compose -f infra/docker/docker-compose.local.yml up
```

Wait for the logs to settle (first start downloads images and runs `npm ci`, a few minutes), then open http://localhost:5173.

- Sign in as `testuser` / `Test@1234`.
- You will be asked to set up a one-time-code app (FreeOTP, Google Authenticator or Microsoft Authenticator). Scan the QR code and enter the 6-digit code.
- Keycloak admin console: http://localhost:8080/admin (`admin` / `admin`, local only).
- Stop with Ctrl+C. Use `docker compose -f infra/docker/docker-compose.local.yml down` to reset to a clean state: the realm is re-imported from `iam/keycloak/realms/iam-platform-realm.json`, which is the source of truth. Keycloak skips the import when the realm already exists, so edits to that file only apply after a `down`.
- If port 5173 or 8080 is busy, stop whatever uses it. The app runs on 5173 and the realm only allows localhost ports 5173 and 5174.

## Features
- SSO (Single Sign-On) via OIDC & SAML 2.0
- RBAC (Role Based Access Control)
- SCIM 2.0 User Provisioning
- JIT (Just-In-Time) Provisioning
- LDAP Federation
- MFA (Multi-Factor Authentication)
- B2B Identity Federation
- Audit Logs
- Kubernetes Ready

## Stack
| Layer | Tool |
|-------|------|
| IAM Core | Keycloak |
| Reverse Proxy | Traefik |
| Orchestration | K3s (Kubernetes) |
| CI/CD | GitHub Actions |
| Frontend | React + Vite |
| Database | PostgreSQL |
| Monitoring | Grafana + Loki + Prometheus |

## Folder Structure
- `apps/` — frontend and backend applications
- `infra/` — docker, kubernetes, traefik configs
- `iam/` — keycloak themes, realm exports, LDAP, SCIM
- `ci-cd/` — pipeline definitions
- `monitoring/` — observability stack
- `docs/` — architecture decisions and diagrams
