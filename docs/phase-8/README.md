# Phase Eight planning workspace

The canonical decision map is [Wayfinder: Phase Eight Rich Household and Multi-Domain Collaboration](https://github.com/nick-neely/tendnote/issues/355).

This directory holds durable research, prototype handoffs, and other supporting artifacts produced while that map is worked. Product decisions live in their resolution tickets and are synthesized into [`docs/prd.md`](../prd.md), [`CONTEXT.md`](../../CONTEXT.md), and only the ADRs that earn their place.

- [Household activation journey](household-activation-journey.md) — Account
  entry, immediate solo activation, verified-address invitation acceptance, and
  the deliberately limited Household Overview return point.
- [Household setup and member management UX](household-setup-and-member-management.md)
  — the selected people-first Household composition, durable local navigation,
  invitation and role management, and focused departure and recovery flows.
- [Household Context management and correction](household-context-management-and-correction.md)
  — shared member authority, conflict-safe correction, evidence privacy,
  sensitivity, lifecycle, and activation across Account, Eve, Review, Capture,
  and Search.
- [Shared Household home and Today relationship](shared-household-home-and-today.md)
  — the durable global Household coordination surface, its boundary from each
  member's private Today and Account management, and its composition, trust,
  responsive, and domain-authority contracts.
- [Shared Household Actions, Routines, and reminder coordination](shared-household-actions-and-reminders.md)
  — household-native versus member-owned ownership, per-form authority, shared
  occurrences, the Responsibility Holder and its completion hand-off, per-member
  reminders, and composition into Household and Today.
- [Household gift ideas and birthday planning with surprise privacy](household-gift-ideas-and-birthday-planning.md)
  — member-owned, selected-co-planner Gift Plans; recipient-exclusion surprise
  privacy; grounded review-first creation; lightweight self-claims; and
  fail-closed collaboration, reminder, and lifecycle behavior.

## Working agreement

- Accumulate the remaining Phase Eight planning artifacts on
  `docs/phase-8-wayfinder` and its persistent draft pull request. The merged
  `docs/phase-8-spec` branch and PR #361 remain the specification baseline.
- Do not create per-ticket planning branches or pull requests.
- Keep the map as the decision index; do not duplicate full resolutions here.
- Resolve exactly one non-research ticket per session.
- Integrate each resolved ticket's durable artifacts as a separate logical commit and push it to the shared branch.
- Allow only one writer on the shared branch at a time. Independent research may run concurrently, but its durable artifact is integrated by the single writer.
- Keep the pull request in draft until the final specification-synthesis ticket confirms that the complete Phase Eight specification is ready for implementation-ticket slicing.
