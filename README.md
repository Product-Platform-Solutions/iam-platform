# IAM Platform

Enterprise-grade Identity & Access Management built entirely on open source. Zero cost.

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
