# Phase 9b planning workspace

The canonical decision map is [Wayfinder: Phase 9b Commercialization](https://github.com/nick-neely/tendnote/issues/564).

## Shared branch and pull request

All durable artifacts for the entire map accumulate on `docs/phase-9b-wayfinder`
and one persistent draft pull request targeting `main`. This includes research,
grilling outcomes, prototypes, PRD and glossary changes, and warranted ADRs.
Do not create per-ticket branches or pull requests, including for research.

At session startup, inspect `git status`, fetch, switch to the shared branch,
and fast-forward from origin before editing. Preserve unrelated work; use a
clean checkout if switching would disturb it. Never reset or force-push to
resolve concurrent work.

Only one session writes or integrates the shared branch at a time. Research
may run independently, but its durable output is handed to that writer for
integration. Each ticket's artifacts receive their own logical commit and are
pushed to the same draft PR. Record the answer on the ticket and link the
published artifact, then close the ticket and index its resolution on the map.
Resolve at most one non-research ticket per session.

Keep the PR open and in draft across sessions until final specification
synthesis and review. Do not merge it after each ticket. Product implementation
and its delivery workflow follow this planning effort separately.

## Destination and rationale

Specify a small, real paid service operated by the author, including the full
marketing site and self-service discovery, demo, subscription, onboarding,
first value, billing management, and cancellation. Building and operating real
payments is an explicit learning goal; unprompted demand is no longer a build
prerequisite. The map records this owner-approved change to the earlier demand
gate. The observed newcomer walkthrough remains a launch-readiness check.

Decision detail belongs on the map's tickets. This directory is an artifact
entry point, not a second decision index.
