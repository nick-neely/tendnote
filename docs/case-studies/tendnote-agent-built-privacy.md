# Tendnote: an agent-built system with inspectable privacy invariants

This is the Canonical Case Study for Tendnote's repository publication. It
makes one bounded claim:

> An agent-built personal system can carry privacy-sensitive design invariants
> that a skeptical technical reader can inspect in decisions, code, tests, and
> preserved execution evidence.

The claim is deliberately narrower than “the system is correct.” It is not a
security audit, a certification, a claim that every code path has been read, or
evidence that Household collaboration has been validated by multiple people.

## The inspection path

The path is intentionally short and reproducible:

1. **Claim and boundary.** The privacy invariants are concrete: ownership and
   visibility are checked at the query seam, model-originated writes stay
   review-gated, external actions require approval, and ambiguous authority
   fails closed.
2. **Decision.** [ADR 0230 in the reviewed content bundle](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/adr/0230-case-study-keeps-evidence-canonical-and-presentation-separate.md)
   governs what this Case Study claims and how evidence is presented. The
   publication ordering is recorded in [ADR 0228 in the reviewed content bundle](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/adr/0228-publication-precedes-commercialization.md).
3. **Exact gate evidence.** The deterministic suite's clean first-sample
   result is the publication qualification bar. The preserved [Gemini
   deterministic evidence bundle in the reviewed content bundle](https://github.com/nick-neely/tendnote/tree/00b2edcb11be862f747a96851eb66b71dcaefd7f/evidence/evals/0031e09bd92b1ce51d2f5235a0d10172aa1da8c8)
   is the exact recorded run for this source line.
4. **History.** The complete git history remains available for inspecting how
   the decisions, implementation, tests, and failures accumulated.

The [Reader Evidence Path decision in the reviewed content bundle](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/adr/0234-reader-evidence-path-starts-at-the-readme.md)
explains why the root README is only the doorway and why this planning
workspace is not a newcomer route.

## What the controls mean

The claim is inspectable because the relevant boundaries have named owners in
the repository:

- [Security and privacy](../security.md) describes query-layer ownership,
  visibility, sensitivity, review, approval, and fail-closed controls, along
  with the limits that remain model-policy or operator responsibilities.
- [ADR 0001](../adr/0001-shared-owner-scoped-mutations.md), [ADR 0054](../adr/0054-sensitivity-and-scope-are-distinct.md),
  [ADR 0137](../adr/0137-privacy-guard-reviews-after-deterministic-scope.md),
  and [ADR 0197](../adr/0197-conversational-capture-separates-explicit-and-inferred-authority.md)
  show how those boundaries were decided rather than inferred from the prose
  of this document.
- Product and agent tests live beside the owning query, tool, and policy
  seams. The evidence bundle records the model-run output separately from
  those deterministic tests, so a test result is not silently presented as a
  model result.

## The gate and its actual result

The required gate is a manually dispatched, strict deterministic run: every
selected case must pass on its first sample, with no failures, retry recovery,
or skipped cases. That is what “clean” means here. The [publication decision
in the reviewed content bundle](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/adr/0228-publication-precedes-commercialization.md)
keeps that bar intact.

The exact preserved bundle for the current source line used
`google/gemini-3.7-flash` and recorded **52 passed, 8 failed, 0 skipped, and 0
errored** across 60 cases. Its exit code was `1`, and the bundle explicitly
states that it is exploratory evidence, not clean deterministic
qualification. It is linked here so a reader can inspect the result rather
than being asked to accept a clean-sounding summary. The later judged bundle
is also preserved, but judged quality is outside this deterministic gate.

The raw reports and checksums are in the [immutable evaluation bundle](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/evidence/evals/0031e09bd92b1ce51d2f5235a0d10172aa1da8c8/README.md).
The clean-gate requirement therefore remains visible and the non-clean result
remains classified; neither is converted into a publication pass by wording.

## Limits beside the evidence

The latest approved disclosure belongs beside the result above:

- I have personally read **roughly 15% of the code**.
- This is the suite's **first Phase 9a evaluation**, not a continuous track
  record.
- Household collaboration has **not been exercised with a second person**.
- A clean run, when one exists, supports only the behavior it evaluates; it
  is **not a blanket correctness claim**.

These are scope limits on the case study, not rhetorical footnotes. They are
why the decision record and exact raw output remain part of the path.

## Immutable reviewed-content bundle

This Case Study, ADR 0230, ADR 0228, ADR 0234, the documentation indexes,
and the preserved deterministic evidence are reviewed as one content bundle.
The [reviewed-content bundle commit](https://github.com/nick-neely/tendnote/commit/00b2edcb11be862f747a96851eb66b71dcaefd7f)
is an immutable inspection anchor, not an exact qualified integration or
publication commit. A pre-qualification SHA must not be presented as that
final pin.

The exact integration commit and release verdict are reserved for [#488](https://github.com/nick-neely/tendnote/issues/488),
which owns the Phase 9a qualification report. It must identify the commit only
after the clean gate and every other publication check pass. Until that report
exists, this Case Study records the reviewed content and the evidence it
contains; it does not imply repository publication.

The evaluated source is identified by the evidence metadata as
[`0031e09bd92b1ce51d2f5235a0d10172aa1da8c8`](https://github.com/nick-neely/tendnote/commit/0031e09bd92b1ce51d2f5235a0d10172aa1da8c8).
The checked-in evidence directory contains the exact reports and checksums for
that source. For direct inspection, use the [ADR 0230 file](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/adr/0230-case-study-keeps-evidence-canonical-and-presentation-separate.md),
[ADR 0228 file](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/adr/0228-publication-precedes-commercialization.md),
[ADR 0234 file](https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/adr/0234-reader-evidence-path-starts-at-the-readme.md),
the [evidence tree](https://github.com/nick-neely/tendnote/tree/00b2edcb11be862f747a96851eb66b71dcaefd7f/evidence/evals/0031e09bd92b1ce51d2f5235a0d10172aa1da8c8),
and the [preserved bundle history](https://github.com/nick-neely/tendnote/commit/00b2edcb11be862f747a96851eb66b71dcaefd7f).
No branch, moving preview, or latest-history URL is evidence.

This document is the repository source of truth for the case-study claim. No
parallel launch document or commercial material belongs in this path.
