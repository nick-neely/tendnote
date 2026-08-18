# Self-Hosting Is Scoped To The Operator's Own Vercel Deployment

Publishing under ADR 0224 creates a self-hosting expectation. The current
topology cannot satisfy an unqualified one, so the promise must be scoped
before it is made rather than corrected afterward in an issue thread.

Tendnote is coupled to the Vercel platform in ways that are load-bearing, not
incidental. ADR 0194 places Eve authentication inside a separately deployed
service, with the platform routing `/eve/v1/**` ahead of Next.js filesystem
routing, so the boundary is the platform's rather than the application's.
Background job delivery runs on `@vercel/queue` per ADR 0068, private beta
admission evaluates through Vercel Flags per ADR 0067, and `@vercel/oidc` and
`@vercel/postgres` sit underneath.

## Decision

**Self-hosting means deploying Tendnote to the operator's own Vercel account**,
with their own Neon database, Redis instance, model credentials, and OAuth
applications. The README states that scope explicitly.

Tendnote does not promise a platform-neutral deployment. There is no supported
container image, no abstraction over the job queue, no replacement for flag
evaluation, and no off-platform answer for the Eve routing topology. An
unqualified "self-hostable" claim would be a promise the architecture does not
keep, and discovering that in a bug report is worse for the project than
stating it in the README.

Private Beta Access is a hosted admission concern, not a self-hosting
prerequisite. A supported operator deployment uses the explicit, household-
bounded admission mode in ADR 0232 instead of requiring the operator to
configure Tendnote's managed-service Flags gate.

This scope is a boundary on the *promise*, not a prohibition on the work. A
platform-neutral path may be built later if demand for it is evidenced, and
this ADR is the record of why it was not built speculatively.

## Consequences

Operators who will not use Vercel cannot run Tendnote today. That narrows the
self-hosting audience and is accepted: self-hosters pay nothing and generate
the largest share of support load, so an unbounded promise converts the free
tier into unbounded unpaid support.

The Vercel coupling identified above is therefore acceptable to keep, and new
coupling does not require justification against a portability goal the project
has not adopted. If that goal is ever adopted, the queue, the flag evaluation,
and the Eve routing topology are the three known places the work lands.

Requests for a container image become a demand signal worth reading rather than
a defect. They should be counted, not silently accepted as a backlog item.
