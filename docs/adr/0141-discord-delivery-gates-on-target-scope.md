# Proactive Discord Delivery Gates On Phase 4 Target Scope

Scheduled-workflow Discord delivery (#170) is a proactive nudge for a persisted
Tendnote artifact, never a source of truth and never an unrestricted disclosure
surface. Before anything reaches Discord, `deliverDiscordScheduledArtifact`
evaluates a fail-closed policy over the artifact's owner, sensitivity, and
visibility scope against the owner-scoped delivery setting's target policy
(`scheduled_workflow_delivery_settings`). A skip is recorded as an attempt, so the
in-app artifact stays reviewable whether the send is filtered, fails, or succeeds.

The delivery setting now carries the target's disclosure profile rather than just a
channel id: `target_scope` (`private` by default), `target_household_id`, and
`allow_private_summary`. A `private` target is owner-only and is the fail-closed
default: it is safe for the owner's own artifacts of any scope, so an omitted target
scope can never over-disclose. Sharing gates apply only once a target is explicitly
configured as shared/household. The upsert input leaves these three fields optional
so callers opt in to shared/household delivery instead of opting out.

The scope matrix, evaluated after the existing sensitivity gates (`restricted` is
never delivered; `sensitive` requires `allow_sensitive`):

- **Private target** — always allowed for the owner's artifacts (owner-only
  audience). No further gating.
- **Household artifact → shared/household target** — allowed only when the target is
  explicitly `household`-scoped *and* its `target_household_id` matches the
  artifact's household, so one owner's household channel can never receive another
  household's content (`household_target_required` / `household_target_mismatch`).
- **Private artifact → shared/household target** — filtered
  (`private_content_filtered`) unless `allow_private_summary` is explicitly set, in
  which case only the summary-only nudge is posted. The nudge renderer never emits
  artifact detail, so the "safe summary" allowance stays safe by construction.
- **Shared (selected-members) artifact → shared/household target** — always filtered
  with its own `shared_content_filtered` reason. A Discord channel cannot honor
  selected-member granularity, so a shared-scope artifact has no honest home on one;
  the distinct reason keeps the skip record truthful rather than misfiling it as a
  private filter.
- **Unknown artifact scope** — treated as `private` (fail-closed), so an artifact
  that never plumbed a scope is never broadcast to a shared channel.
- **Owner boundary** — a defensive `owner_mismatch` guard rejects any artifact whose
  owner differs from the setting's owner, even though the setting is looked up by the
  artifact's owner today.

`target_household_id` is a real `uuid` foreign key to `household_workspaces`
(`ON DELETE set null`), matching every other household reference in the app schema
(`memories`, `followups`, `source_records`, `household_workspaces`) rather than a
loose text id.

**Sensitivity and the private-summary allowance never compound.** `allow_sensitive`
and `allow_private_summary` are independent per-target consents, but they are
deliberately not multiplicative: a `sensitive` private artifact is never posted to a
shared/household target even when both flags are set. `allow_private_summary` consents
to broadcasting a *private* summary to a broader audience; it does not also consent to
disclosing *sensitive* material there. The private-summary path therefore requires
`normal` sensitivity, and sensitive private content stays on `private`, owner-only
targets. This is an explicit decision, not a side effect of gate ordering.

**Deviation from AC4.** The issue's acceptance criterion reads: "Household-visible
artifacts are delivered only to explicitly configured household-safe Discord targets."
Taken literally, a household artifact could never reach the owner's own private target.
We deliberately deviate: a `private` target is owner-only, so delivering the owner's
own household artifact there discloses to no additional audience and is allowed. The
spirit of AC4 — never leaking household content to an unconfigured or broader-than-
household channel — is preserved, because the only widening path (a shared/household
target) still requires an explicit household-safe match. This deviation is pinned by a
test asserting household-artifact → private-target is delivered.

This mirrors the Phase 4 read-side semantics (`canViewScopedRecord`, ADR-0140): a
Discord target is treated as an audience, and delivery is refused whenever the
target's audience is broader than the artifact's scope permits, unless an explicit
owner-configured policy opens a narrow, summary-only path.
