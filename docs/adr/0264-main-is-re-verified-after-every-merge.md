# Main Is Re-Verified After Every Merge

ADR 0236 verifies every pull request push at full fidelity, but against the
base the branch last pushed on. Branches are not required to be up to date
before merging, so two pull requests can each pass and still break main
together. On 2026-10-04, #731 added a test written against an input shape #729
then made stricter. Both were green, and main failed its Production build. The
same day, the documentation-only #732 skipped every lane by path filter and left
main failing the publication gate, which scans the whole tree.

## Decision

Every push to main runs the reusable verification workflow with every lane on
and no path filtering. Nothing is gated on the result: it is a fast detector
whose failure notifies whoever merged, who then fixes forward. A newer merge
cancels an older run, because it verifies a tree that already contains it.

## Consequences

A crossed merge is caught within one verification run of landing, and a test
failure is caught even when Vercel's build passes. Production is still protected
separately, because a failed Vercel build leaves the previous release serving.
Each merge costs one more full run, about a cent, and main can be red until the
fix-forward merges.

## Alternatives

- **Require branches to be up to date.** This closes the gap before merge, but
  every merge then sends every other open pull request back through CI. With
  several sessions merging in parallel, that rerun queue was the main cost of
  development.
- **Merge queue.** This verifies each pull request against the queue ahead of
  it, without the reruns. GitHub offers it only to organization-owned
  repositories, and moving the repository to an organization touches Vercel,
  the CLA assistant, RunsOn, and every app installation. It is worth revisiting
  if crossed merges become frequent.
- **Path-filtered main runs.** These would cost less, but the path filter is
  exactly what let #732 skip the publication gate.
