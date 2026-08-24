# Pull Request Verification Is One Full-Fidelity Path

Verification was split into a cheap lane on every push and an expensive lane a
maintainer had to request with the `full-ci` label. That split existed to ration
GitHub-hosted Actions minutes, and it made the exact commit that merges the one
commit least likely to have been fully verified: the label had to be removed and
reapplied after every later push. Verification now runs on self-hosted AWS spot
runners, where a complete run costs about a cent, so minutes stopped being the
constraint the design was solving for.

## Decision

Every push to a pull request runs every lane its changed paths implicate, at
full fidelity: quality, coverage-backed tests with the Fallow audit, the
real-browser contracts, the Instant Interaction matrix, and the database replay.
Path filtering still decides which lanes apply, so a change confined to
`packages/auth` runs no database replay. What is gone is the second axis: there
is no label, no tier selection, and no qualification step, and no lane is
deferred to a later run. The required checks are the verification
jobs themselves rather than aggregate gate jobs, relying on GitHub's documented
rule that a skipped job reports its status as success for a required check. A
documentation-only pull request therefore still satisfies every required check,
because the workflow always starts and each lane skips itself.

The fast lane is removed rather than kept alongside. Its `turbo test --affected`
put every package in scope on a routine change and ran the same test files as
the full lane, in 63 seconds against 144; the difference was coverage
instrumentation and the collector's deliberate throttles, not suite size. It was
a second execution of the same behavior gate at lower fidelity.

Package-level affected testing is sound in principle and buys nothing here,
because `apps/web` is both the long pole and in scope for nearly every change.
File-level affected testing is rejected outright: an import graph is blind to
mocks, globals, environment, CSS, and fixtures, so `vitest --changed` would
silently drop real coverage, and the Fallow coverage canary needs a whole-repo
map to score anything. `pnpm test:affected` remains a local iteration tool,
where a wrong answer costs a rerun rather than a merge.

Sharding is declined for now. Cost is proportional to vCPU-minutes, so a wider
runner buys the same parallelism as more runners without paying for a second
runner boot, a coverage-merge job, and artifact transfer between them. The
coverage lane is pinned to 16 vCPU instead, which doubles the workers the
collector hands `apps/web`.

## Consequences

Every commit that can merge has been verified at full fidelity, and the
per-commit result is current by construction rather than by remembering to
re-label. The cost is that routine pushes now pay the coverage lane's wall time,
which the pinned runner width absorbs; the aggregate has to stay under the nine
minutes ADR 0210 set. If the suite outgrows one runner, sharding becomes the
next lever, and it is a change to this lane rather than a return to tiering.
