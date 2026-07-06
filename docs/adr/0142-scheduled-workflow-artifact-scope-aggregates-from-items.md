# Scheduled-Workflow Artifact Scope Aggregates From Its Items

The proactive Discord delivery policy (#170, ADR-0141) gates on a scheduled
artifact's `scope`/`householdId`, but the four workflow builders (morning agenda,
post-meeting aftercare, weekly relationship review, birthday gift planning) never
set them, so every artifact fell closed to `private`. The household branch of the
ADR-0141 matrix was therefore only reachable from unit tests. This ADR defines how
each builder derives a real aggregate scope so a genuinely household-visible
artifact can deliver to a household-safe target, without weakening the delivery
matrix.

## Aggregation rule

`aggregateArtifactScope` (`packages/domain/src/scheduled-workflow-artifact-scope.ts`)
is the single, pure policy seam. It reduces the disclosure facts of the items an
artifact is built from to the artifact's scope:

> **An artifact is only as shareable as its least-shareable item.** It carries
> `scope: "household", householdId: H` **only** when it is built exclusively from
> `household`-visible items that all belong to the same household `H`. Every other
> case fails closed to `private`:
>
> - an empty artifact (no household to key on),
> - any item of unknown scope (a builder that never plumbed a scope),
> - any `private` item,
> - any `shared` (selected-members) item — a Discord channel cannot honor
>   selected-member granularity (ADR-0141), so it can never widen an artifact,
> - a `household` item missing its household id,
> - `household` items spanning two different households.

The seam is exhaustively unit-tested. It is the input to
`ScheduledWorkflowDeliveryArtifact.scope`; the ADR-0141 matrix still gates that
scope against the target's policy and is unchanged. Sensitivity is evaluated first
in the matrix and never compounds with scope — a `household`, `sensitive` artifact
is still filtered on a household target that disallows sensitive content.

## How each builder derives item scope

- **Morning agenda / weekly relationship review** aggregate over their persisted
  brief items. Brief items now snapshot the backing record's `scope`/`household_id`
  (new `brief_items` columns, migration `0028`), populated in the generator from the
  relationship-agenda candidate, which in turn carries the follow-up / memory /
  source-record scope collected from the visible-record queries. A calendar-highlight
  brief item is the owner's own schedule and is always `private`. The weekly review
  additionally folds in memory-curator proposals and unresolved drafts as `private`
  (owner-only review surfaces, ADR-0123/0125), so a review containing either fails
  closed. Consequently the morning agenda is the primary genuine household path: a
  brief built solely from whole-household follow-ups/memories for one household, with
  no calendar highlights, aggregates to `household` and delivers to a matching
  household target end-to-end.
- **Post-meeting aftercare** aggregates over calendar-derived suggestions. These are
  drawn from the owner's private calendar (Phase 2C) and carry no household
  visibility, so the artifact fails closed to `private`.
- **Birthday gift planning** aggregates over its proposal JSON, which now carries the
  candidate's `scope`/`householdId`. Birthdays come from person profile data, which
  is owner-scoped today, so real plans are `private`; the aggregation still honors a
  household scope should a proposal ever carry one.

## Why snapshot scope onto brief items rather than re-derive at delivery

`generateBrief` persists and re-reads its items, so an in-memory-only scope on the
brief would not survive to the delivery call. Snapshotting `scope`/`household_id`
onto `brief_items` mirrors the existing `followups` / `memories` / `source_records`
columns and keeps the brief a self-contained, re-readable artifact — render and
feedback code ignore the new columns. The alternative (re-querying the underlying
records' scope at delivery time) would duplicate the agenda's selection logic and
risk diverging from what the brief actually contains.

## Delivery-after-revocation window (accepted risk)

Because the brief is a re-readable snapshot and scheduled generation is idempotent,
a window exists where a delivered artifact's scope is staler than the live records.
If the owner generates a brief early (e.g. the web action at
`apps/web/src/app/actions/briefs.ts`) while a backing record is `household`, then
narrows that record `household → private`, the later scheduled run returns the
pre-existing brief with its `household` scope snapshot and delivers the nudge to the
household channel. The gap is up to the cadence period — hours for the daily morning
agenda, up to a week for the weekly review. This is content-bearing: the decorative
summary is built from item titles/reasons/person names, so the household nudge can
echo text from the since-narrowed record, not merely a count.

**We accept this window rather than rechecking scope at delivery time**, for reasons
that are specific to this artifact model:

- **Snapshot coherence.** A brief is a deliberate immutable snapshot (PRD #65,
  ADR-0008): its item titles, reasons, ranks, and decorative summary are all frozen
  at generation and never recomputed from live records. Scope is captured in the same
  snapshot. Making scope alone "live" while the very content it gates stays frozen
  would be incoherent — the summary would still carry the old text even if a
  re-derived scope said "private". The honest unit of freshness here is the whole
  brief, and its freshness knob is regeneration (which supersedes the prior brief),
  not a per-field recheck.
- **The content was legitimately household-visible when captured.** At generation the
  record was whole-household visible, so the household audience already had standing
  access to it. Post-hoc narrowing revokes *future* access; ADR-0135 already
  establishes that revocation revokes access, not history, and a persisted artifact
  from when access existed is history.
- **Bounded and self-healing.** The window closes at the next scheduled generation for
  the period, and any explicit regeneration re-derives scope from live records and
  supersedes the stale brief.

A delivery-time recheck (re-reading each brief item's backing follow-up / memory /
source record by its `sourceRefs` and re-aggregating, failing closed on any
narrowing) is the alternative. We rejected it for now because it would couple the
generic, matrix-based delivery path to three record stores and reintroduce
scope-resolution logic outside the generator — new surface and duplication for a
narrow, self-healing window — without changing the ADR-0141 matrix it would sit in
front of. It remains the natural mitigation if this window is ever judged
unacceptable; it would attach at the builder (which already holds store access),
leave the matrix untouched, and warrant a test for the narrowed-after-generation
case.

## Fail-closed posture

Every uncertainty resolves to `private`, which the ADR-0141 matrix treats as the
owner-only, non-widening scope. A builder that gains new item kinds without a scope,
a record with a null household, or mixed-household content can only ever narrow an
artifact's audience, never widen it. This preserves the Phase 4 read-side invariant
(`canViewScopedRecord`, ADR-0132/0140): a Discord target is an audience, and content
is never disclosed to an audience broader than its own scope permits.
