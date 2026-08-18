# Publication Precedes Commercialization

Tendnote has never received a demand signal from anyone other than its author.
No one has asked for it, tried it, or requested a hosted version. Nine phases
were specified and built on the author's own conviction, which is a legitimate
way to build a personal tool and an unreliable basis for building a business.

The two remaining bodies of work have very different costs. Publishing is a
private-data split, a license, a README, and a writeup. Commercializing is a
marketing site, Stripe, terms and privacy policy, an admission flow for
strangers, and the support posture to go with it.

## Decision

**The public repository ships before any commercial surface**, and hosted
commercialization is gated on evidence produced by the publication.

The evidence sought is specific: unprompted requests for a hosted option from
people who are not the author, following publication. That question, asked by
strangers, is the demand validation the project has never had, and publishing
is the cheapest possible way to run the experiment.

The roadmap therefore splits Phase 9 in two. Phase 9a publishes. Phase 9b
commercializes and does not begin until 9a has produced the signal.

Two sequencing rules attach to this:

**The eval suite executes at least once before publication.** The repository's
claim on a reader's attention is rigor, and the first thing a skeptical reader
checks in an agent-built codebase is whether any of it is verified. A workflow
that has never run, in a git history that says so plainly, answers that
question badly. More importantly, the results are the evidence section of the
case study: "built with agents" invites the question of whether it is correct,
and only an executed suite answers it.

**The tool-surface reduction of ADR 0227 follows publication.** It is an
optimization rather than a credibility artifact, and it makes better material
after the repository is public than before.

## Consequences

If no hosting demand appears, the commercial buildout is never paid for. That
is the intended outcome of the gate, not a failure of it.

If demand does appear, the requests themselves are the market research that
would otherwise have to be commissioned or guessed at.

The case study reaches its audience months earlier than it would under a
simultaneous launch, which matters because that audience is the primary one.

Publication is close to irreversible. A public repository, its inbound links,
and its build-in-public posts cannot be recalled, so anything that must be
settled before strangers read the repository has to be settled in 9a. Naming is
the clearest example and is resolved in favor of keeping Tendnote.
