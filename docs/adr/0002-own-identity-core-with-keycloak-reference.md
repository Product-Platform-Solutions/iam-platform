# ADR 0002: Build an own identity core, with Keycloak as reference and fallback

Status: Proposed (decisions below were given by the owner on 2026-10-13; the timeline is a proposal awaiting his confirmation)
Supersedes: nothing. Builds on ADR 0001 (Keycloak 26 for local development).

## Context
The project currently depends on Keycloak for authentication. The owner wants two things at once:
1. To learn how agents work and grow toward running an agent organisation.
2. A mature identity product the project itself owns, with no permanent dependency on third-party identity software.

Authentication is security-critical, so "own it" needs an objective definition of "correct", and a rule for who approves changes.

## Decisions (from the owner)
1. **Both aims.** Learning agents and an independent product, pursued together, provided it fits the 16-week programme.
2. **Keycloak stays as reference and fallback.** It is the default until the retirement criteria below are met. The eventual goal is a mature product independent of it.
3. **Upgrade policy: patch-level only** may merge automatically, and only when the full test suite passes. Minor and major upgrades, and any change to the security core, need a human review. This is relaxed only after the test suite described below exists and has earned trust.

## Design rules
- The product talks to identity through a small interface (create user, assign role, read audit events, start login). Keycloak and the own core are two implementations behind it.
- Tests come first. The OpenID Foundation conformance suite, run against Keycloak as a baseline, defines "correct". The own core must match it.
- Build on vetted libraries for cryptography, JWT and WebAuthn verification. Do not hand-write primitives.
- A human approves every merge into the security core (token signing, sessions, credential verification, passkeys). Agents may open pull requests and run tests, but not merge there.
- The project does not claim "production-ready" or "military grade" for the own core until it passes conformance, has fuzz and negative-path tests, and has had an independent review.

## Retirement criteria for Keycloak as default (all required)
1. Own core passes the OpenID conformance profiles the product claims.
2. Own core passes the project's negative and abuse test suite (replayed codes, reused refresh tokens, bad redirects, token confusion, brute force).
3. Passkey and TOTP flows pass the same end-to-end tests as on Keycloak.
4. An independent security review has no open high findings.
5. A rollback to Keycloak has been rehearsed.

## Consequences
- More work than option 1 alone, and a review burden on the owner.
- A realistic Week 16 outcome is a working own core that passes the baseline conformance profile for core flows, with Keycloak still the default. Full retirement of Keycloak is a later milestone, tied to the criteria above.
- Automated checks (dependency updates, advisory and standards watching) open issues or pull requests. They do not merge security-core changes.
