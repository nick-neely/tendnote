# Next.js Preview Reuses the Private-Beta Release Path

Tendnote will ship the Next.js 16.3 Preview through its existing one-owner
private-beta release path rather than add canaries, shadow traffic, a second
manual promotion approval, automated rollback, or a new observability system.
The upgrade PR is the human go/no-go: after it merges, the existing GitHub
Actions flow may wait for the staged Vercel deployment, apply required
migrations, pass the Production Release Gate, and promote automatically without
an upgrade-specific post-merge smoke job.

The rollout candidate pins both `next` and `@next/playwright` to
`16.3.0-preview.9` with an exact lockfile. Before merge, that exact candidate
must pass repository verification, a production build, the full critical
navigation and browser qualification in ADR 0210, two-owner cache and privacy
checks, mutation reconciliation, and authenticated Better Auth and Eve smoke
tests against the PR Preview. Any later Preview or stable version is a new
exact-pin candidate on another PR and repeats the same qualification; framework
packages never float or update automatically.

Before merge, the PR records the commit and Vercel deployment for the last
known-good Next.js 16.2.11 production release. After promotion, the owner
performs a minimal non-destructive smoke of sign-in, Today, People and a person
detail, Actions, Review, and Eve while watching existing Vercel deployment and
function error, rate, and latency signals. Active observation lasts one hour,
followed by heightened observation through 24 hours, with the known-good
deployment retained for reversal throughout.

Correction of fact, not of decision: the last known-good production release runs
Next.js **16.2.9**, not 16.2.11. `16.2.11` was the `next@latest` npm tag when the
adoption research was written; Tendnote's pin was `16.2.9` from its first commit
until the Preview candidate replaced it. Wherever this decision says 16.2.11,
read 16.2.9. The recorded commit and deployment are in
[the Preview qualification record](../verification/nextjs-16-3-preview-qualification.md).

Any credible owner-data leak, admission or authorization bypass, destructive
write corruption, or cross-owner cache contamination triggers immediate
rollback. A reproducible sign-in loop, blank or frozen primary navigation,
unusable streamed content, hydration or module failure, mutation reconciliation
failure, or Eve routing failure also triggers rollback; an isolated transient
infrastructure error is investigated unless it repeats or reproduces.
Performance diagnostics alone do not trigger reversal unless they cause a
user-visible breach of the Instant Interaction contract.
