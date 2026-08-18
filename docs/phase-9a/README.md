# Phase 9a planning workspace

The canonical decision map is [Wayfinder: Phase 9a Publication](https://github.com/nick-neely/tendnote/issues/447).

Phase 9's original question, whether Tendnote stays private, becomes an OSS
template, or becomes a product, is already settled and is not part of this map.
It resolves to an AGPL-3.0 open-core project with a paid hosted service,
published before any commercial surface exists. That strategy lives in ADRs
[0224](../adr/0224-tendnote-publishes-as-agpl-open-core.md) through
[0228](../adr/0228-publication-precedes-commercialization.md) and in
[`docs/prd.md`](../prd.md) under "Phase 9a: Publication".

This map finds the way to a publishable repository: the decisions that must be
settled before strangers can read it. Publication itself is execution and sits
past the map.

This directory holds durable research, prototype handoffs, and other supporting
artifacts produced while the map is worked. Product decisions live in their
resolution tickets and are synthesized into [`docs/prd.md`](../prd.md),
[`CONTEXT.md`](../../CONTEXT.md), and only the ADRs that earn their place.

## Settled before charting

These are inputs to the map, not questions in it. Do not relitigate them.

- **AGPL-3.0 open core** (ADR 0224). The Eve instruction set and the ADR corpus
  are published in full rather than withheld as a moat; hosted differentiation
  is operational. A CLA is collected from the first external pull request.
  Issues are open with no service level agreement, and self-host support is
  community-only.
- **Self-hosting is the operator's own Vercel account** (ADR 0225). No
  container image and no platform-neutral path are promised.
- **US-only with no free hosted tier** (ADR 0226). A Phase 9b concern, recorded
  here only so it is not reopened as a 9a question.
- **Sequencing** (ADR 0228, ADR 0227). The eval suite executes once *before*
  publication; the tool-surface reduction follows *after* it.
- **The name stays Tendnote.** The elided `d` is a real phonetic cost, accepted
  because the "tend" semantics carry the product thesis and the launch channel
  is text. `tendnote.com` only: `.dev` and the `tennote.com` defensive
  registration were both declined.
- **Phase 9b is gated** on unprompted hosted-version requests from people who
  are not the author.

## Working agreement

- Accumulate the remaining Phase 9a planning artifacts on
  `docs/phase-9a-wayfinder` and its persistent draft pull request.
- Do not create per-ticket planning branches or pull requests.
- Keep the map as the decision index; do not duplicate full resolutions here.
- Resolve exactly one non-research ticket per session.
- Integrate each resolved ticket's durable artifacts as a separate logical
  commit and push it to the shared branch.
- Allow only one writer on the shared branch at a time. Independent research may
  run concurrently, but its durable artifact is integrated by the single writer.
- Keep the pull request in draft until the map is empty and the way to
  publication is clear.
