# How work is planned and finished

## Hierarchy
| Level | GitHub | Example | Sized in |
|---|---|---|---|
| Initiative (phase) | Issue type Initiative, one per milestone | [P1] Phase: Own OIDC core | Sum of its epics |
| Epic | Issue type Epic, sub-issue of its phase | Authorization endpoint: code flow with PKCE | Sum of its stories |
| Story or Spike | Issue type Story or Spike, sub-issue of its epic | Sign in and return to the app with an authorization code | Story points: 1, 2, 3, 5, 8 |
| Sub-task | Issue type Sub-task, sub-issue of its story | Issue a single-use code bound to client, redirect URI and PKCE | Not sized |

Stories are written as "As a ..., I want ..., so that ..." with Given/When/Then acceptance criteria.
Later phases are broken into sub-tasks when the phase starts (rolling-wave planning).

## Estimates, dates and the scrum bot
- Planning data lives in each issue: the **Planning** table (priority, estimate, start, target) or the issue form fields.
- The scrum bot (`.github/scripts/scrum-bot.mjs`) runs on every issue, branch and pull request event and nightly. It:
  - re-plans every open story from measured velocity (8 points a week until two weeks of finished work exist) and the blocked-by links;
  - rolls dates and estimates up to epics and phases, and moves milestone due dates;
  - fills Status, Priority, Estimate, Start date, Target date and Iteration on the board;
  - closes stories, epics and phases when all their children are closed, and closes finished milestones;
  - links issues created from the forms under their parent and gives them the parent's milestone;
  - labels `needs-refinement`, `needs-breakdown` and `blocked`;
  - keeps the **Board health and sprint report** issue current, posts a sprint review when a sprint ends and a project status update weekly or when health changes.
- `.github/roadmap/plan.json` is the baseline the forecast is compared against. `.github/roadmap/config.json` holds the bot's settings.
- Status is derived, never set by hand: Backlog, Ready (definition of ready met, unblocked, starts within the next sprint), In progress (a `feat/<issue>-...` branch exists), In review (an open pull request), Done (closed).

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
