# Tendnote Publishes As AGPL-3.0 Open Core

Tendnote was built privately and has never been read by anyone outside its
author. Its most transferable artifact is not the running product but the
method behind it: the decision record, the phase specifications, the Eve
instruction set, and the evidence that an agent-built system can carry real
privacy invariants. That artifact only has value if it is readable.

Eve is Apache-2.0, so nothing in the dependency graph constrains the outbound
license.

## Decision

Tendnote publishes under **AGPL-3.0**.

A permissive license would give away the hosted service the project intends to
offer, because anyone could run a modified Tendnote without obligation. A
source-available license such as BUSL would protect the service but would cost
the project the credibility that is the entire reason for publishing: readers
correctly decline to call it open source. AGPL keeps self-hosting genuinely
free while making a competing hosted deployment commercially unattractive,
because network use obliges the operator to publish their modifications. The
common objection to AGPL applies to libraries a company would embed; Tendnote
is a deployed application, where AGPL is ordinary.

The publication is deliberately complete. The repository includes the full
application source, the Eve instruction set, every tool and skill definition,
the subagent prompts, the ADR corpus, the phase specifications, and the eval
suite with its results.

The instruction set is published rather than withheld. It is the most carefully
authored artifact in the project and it is tempting to treat as a moat, but it
is extractable from any deployed instance by a determined user, so withholding
it would forfeit the credibility of a complete case study to protect something
that cannot actually be kept. Hosted differentiation is operational: a customer
pays to avoid running Postgres, Redis, a queue, a scheduler, and several OAuth
applications, not to obtain a prompt.

Only three classes stay out of the repository: secrets and credentials,
personal data in seed or development fixtures, and private beta admission
configuration.

Contributions require a **CLA from the first external pull request**. Under
AGPL each contributor retains copyright in their patch, so dual-licensing, a
commercial exception, or any future relicensing needs permission from everyone
who has ever landed code. Collecting that from the first contributor is free;
reconstructing it from forty is a project-halting event.

The support policy is stated in the README rather than discovered by
contributors: issues are open, there is no service level agreement, and
self-hosting support is community-only.

## Consequences

The project takes on the obligations of a public repository, which are a net
withdrawal of time in the first year. Stars are not labor: a comparable
open-core personal CRM carries 25k stars and 787 open issues, so contributor
help should not be assumed in any plan.

Relicensing optionality is preserved by the CLA but not exercised. Any future
move to dual-license is a separate decision, and this ADR does not authorize
one.

Publishing the instruction set means competitors can read the product's policy
reasoning in full. That is accepted deliberately; the reasoning is the artifact
whose publication has value, and its secrecy was never enforceable.
