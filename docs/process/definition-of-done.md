# How work is planned and finished

## Hierarchy
| Level | GitHub | Example | Sized in |
|---|---|---|---|
| Phase (initiative) | Issue labelled `type:initiative`, one per milestone | [P1] Phase: Own OIDC core | Sum of its epics |
| Epic | Issue labelled `type:epic`, sub-issue of its phase | Authorization endpoint: code flow with PKCE | Sum of its stories |
| Story | Issue labelled `type:story`, sub-issue of its epic | Sign in on a login page and return to the app with a code | Story points: 1, 2, 3, 5, 8 |
| Sub-task | Issue labelled `type:subtask`, sub-issue of its story | Issue a single-use code bound to client, redirect URI and PKCE | Not sized |

Stories are written as "As a ..., I want ..., so that ..." with Given/When/Then acceptance criteria.
Later phases are broken into sub-tasks when the phase starts (rolling-wave planning).

## Estimates and dates
- Pace: 8 story points a week (about 2 hours a day). Start and target dates in each issue come from this pace.
- `.github/roadmap/plan.json` holds the dates; the "Project board sync" workflow copies them to the board.
- Re-plan at the end of each phase: compare points done with points planned and adjust the pace.

## Definition of ready (a story can start when)
- It has a user story, acceptance criteria, an estimate and a priority.
- Its dependencies are done or not blocking.
- Its sub-tasks exist.

## Definition of done (a story is finished when)
- Every acceptance criterion is ticked and demonstrated.
- Code is merged to `develop` through a pull request with CI green.
- Tests cover the change: unit tests, and contract or end-to-end tests where the story touches a flow.
- Security-core changes (tokens, sessions, credentials, passkeys) have a human review, per ADR 0002.
- Docs are updated (README, ADR or docs/testing) where behaviour changed.
- All its sub-tasks are closed.

## Branches and pull requests
- Branch from `develop` as `feat/<issue>-short-name` (or `fix/`, `chore/`). The board moves the issue to In progress.
- Open a pull request that says `Closes #<issue>`. The board moves it to In review; merging closes it as Done.
