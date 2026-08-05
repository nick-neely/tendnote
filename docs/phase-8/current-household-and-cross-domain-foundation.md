# Current household and cross-domain collaboration foundation

Inventory for [Inventory the current household and cross-domain collaboration foundation](https://github.com/nick-neely/tendnote/issues/358), 2026-08-05. This is evidence for Phase Eight decisions, not a decision to preserve every earlier-phase limitation or an implementation plan.

## Reading the current model

The repository already treats a **Household Workspace** as a small shared permission anchor, not as an organization or a replacement for a member's private Tendnote experience. The glossary distinguishes a Household Workspace, Household Member, Household Owner, `private` / `shared` / `household` visibility, and a Household Context fact ([`CONTEXT.md`](../../CONTEXT.md)). The original ADRs make the same boundary explicit: scopes control visibility rather than authority, and removal revokes access rather than rewriting history ([ADR 0130](../adr/0130-household-workspace-is-the-phase-4-permission-anchor.md), [ADR 0132](../adr/0132-household-scopes-define-visibility-not-authority.md), [ADR 0135](../adr/0135-household-member-removal-revokes-access-not-history.md)).

That is a strong base for the map's couple/other small trusted-circle destination. It is not yet a usable Phase Eight collaboration product: there is no household setup or member-management surface, no invitation delivery, and no cross-domain definition of collaboration authority.

## Reusable foundations

### Household identity, membership, and audit

- [`household_workspaces`](../../packages/db/src/schema/app/households.ts) owns a UUID, creator `ownerUserId`, name, and a `defaultScope`; a unique index gives one workspace row per creator. [`household_memberships`](../../packages/db/src/schema/app/households.ts) separately carries a user, inviter, `owner | member` role, `invited | active | removed` status, timestamps, and membership history. [`household_record_shares`](../../packages/db/src/schema/app/households.ts) represents the selected-member audience and records the sharing actor.
- The [`createHouseholdLifecycle`](../../packages/db/src/queries/households/lifecycle.ts) seam already creates the owner membership, authorizes active members/owners, invites a known user, accepts an invitation, removes a member, lists memberships, writes selected-member shares, and appends audit entries. It is the right place to preserve membership checks and actor provenance as Phase Eight changes the lifecycle.
- The domain contract in [`packages/domain/src/households.ts`](../../packages/domain/src/households.ts) is deliberately small and reusable: Household Owner is an active owner membership, not a global administrator.

### Visibility and read-side privacy

- [`canViewScopedRecord`](../../packages/domain/src/privacy.ts) and [`visibleHouseholdRecordSql`](../../packages/db/src/queries/households/visibility-sql.ts) encode the important invariant: private is owner-only; whole-household requires an active membership; selected-member sharing additionally requires an explicit share row. An owner role never bypasses another member's private scope.
- [`resolveRecordVisibility`](../../packages/db/src/queries/households/record-visibility.ts) is the shared write-side guard for a member-owned record: non-private scopes require the record owner to be an active household member, and selected-member sharing needs an active, nonempty audience.
- The policy is exercised across exact recall, semantic retrieval, agenda/review, briefs, and Discord delivery in [`phase-4-household-boundaries.test.ts`](../../packages/db/src/queries/phase-4-household-boundaries.test.ts). This is evidence for retaining fail-closed audience checks while the later tickets decide collaboration behavior.

### Context Facts and Eve orientation

- [`context_facts`](../../packages/db/src/schema/app/context-facts.ts) already has mutually exclusive Self-user and Household-Workspace subjects, lifecycle and sensitivity, creator/last-actor provenance, active/suggested deduplication, and household-only `composition`. Household reads and writes are membership-gated in the shared query layer ([`queries.ts`](../../packages/db/src/queries/context-facts/queries.ts), [`drizzle-store.ts`](../../packages/db/src/queries/context-facts/drizzle-store.ts)).
- [`buildOrientationContext`](../../packages/domain/src/context-fact-orientation.ts) accepts active household ids, filters to policy-eligible facts, bounds the payload, and preserves Self/Household subject provenance as untrusted data. ADR 0212 correctly identifies household setup and collaborative activation as the Phase Eight handoff ([ADR 0212](../adr/0212-context-facts-are-a-distinct-shared-subject-domain.md)).
- The shipped web and Eve adapters are intentionally Self-only: the web action module exports Self Context mutations ([`context-facts.ts`](../../apps/web/src/app/actions/context-facts.ts)) and Eve exposes `remember_self_context` ([`remember_self_context.ts`](../../apps/agent/agent/tools/remember_self_context.ts)). The shared query seam can support household behavior; an activation decision must define who may create, edit, review, archive, and resolve concurrent Household Context changes before adapters are added.

### Personal OS domains already on the rails

The following primary Personal OS seams carry a `scope` and a `householdId`, preserving a member owner and, where applicable, creator/last-actor provenance:

| Domain | Existing reusable seam | Current shape to respect |
| --- | --- | --- |
| Relationship Memories and Source Records | [`memories`](../../packages/db/src/schema/app/memories.ts), [`source-records`](../../packages/db/src/schema/app/source-records.ts), relationship-context search | Member-owned records can become whole-household or selected-member visible without exposing private records. |
| Followups and General Actions | [`followups/lifecycle.ts`](../../packages/db/src/queries/followups/lifecycle.ts), [`general-actions`](../../packages/db/src/queries/general-actions/) | Member-owned operational records already validate household membership and audience; current mutation/read paths have no general rule for a different member to edit the record. |
| Saved Items | [`saved-items`](../../packages/db/src/schema/app/saved-items.ts), [`queries/saved-items`](../../packages/db/src/queries/saved-items/) | The narrow source-grounded fallback is scope-aware, but does not yet define a household-native item or shared editing contract. |
| Assets, Asset Memories, and Asset Evidence | [`assets`](../../packages/db/src/schema/app/assets.ts), [`asset-memories`](../../packages/db/src/schema/app/asset-memories.ts), [`asset-evidence`](../../packages/db/src/schema/app/asset-evidence.ts) | The Asset family uses the same share rails and clamps child visibility to its anchor. It is the clearest existing cross-domain hierarchy seam. |
| Briefs, reminders, and scheduled delivery | [`scheduled-workflow-artifact-scope.ts`](../../packages/domain/src/scheduled-workflow-artifact-scope.ts), [`scheduled-workflow-deliveries`](../../packages/db/src/queries/scheduled-workflow-deliveries/) | Aggregation is fail-closed: a generated artifact is household-visible only when every included item belongs to the same whole household. Delivery is still scheduled per admitted owner, not per workspace ([`schedule-owners.ts`](../../apps/agent/agent/lib/schedule-owners.ts)). |

The common [`household_record_shares`](../../packages/db/src/schema/app/households.ts) registry currently recognizes `memory`, `source_record`, `followup`, `general_action`, `saved_item`, `asset`, `asset_memory`, and `asset_evidence`. It is a useful selected-audience mechanism, not a generic record abstraction or a decision that every domain should become collaboratively editable.

### Existing user-facing and cache seams

- General Actions and Assets already use [`resolveScopeForCaller`](../../apps/web/src/lib/resolve-scope-for-caller.ts) and a calm three-choice control ([`general-action-visibility-field.tsx`](../../apps/web/src/components/general-action-visibility-field.tsx)). The control appears only after active members are available; it does not create or administer a household.
- [`affectedScopesForContextFact`](../../packages/db/src/queries/affected-scopes.ts) can fan a Household Context mutation to each active member's account, orientation, review, and recall projections. The Next adapter currently has an Account/About-you invalidation path only for the existing Self Context surface ([`reconcile-affected-scopes.ts`](../../apps/web/src/lib/cache/reconcile-affected-scopes.ts)).
- Eve's recall tools already describe scope-sensitive results and prohibit disclosure of another member's private context ([`search_relationship_context.ts`](../../apps/agent/agent/tools/search_relationship_context.ts), [`search_semantic_context.ts`](../../apps/agent/agent/tools/search_semantic_context.ts)). There are no household-management or household-context-write tools.

## Gaps and conflicts with the Phase Eight destination

### Lifecycle and governance are Phase 4-shaped

- An invitation is currently an `invited` membership for an already-known user. It has no intended email, secret, expiry, decline/cancel states, delivery attempt, or external-send path; `acceptInvite` only changes that row to active. The dedicated [invitation research](research/household-invitation-delivery-and-abuse-constraints.md) identifies why Phase Eight needs a separate invitation capability.
- The workspace's `ownerUserId` is a single creator anchor, while memberships may be `owner`. Lifecycle authorization is tied to the caller matching an active owner membership, but the API has no co-owner safety rules, ownership transfer, self-leave, removal of another owner, inaccessible-owner recovery, or last-owner invariant. Those are decisions for [Define the Household Workspace lifecycle and governance contract](https://github.com/nick-neely/tendnote/issues/357), not schema constraints to inherit blindly.
- Current storage has no eight-seat policy, no pending-invitation capacity accounting, and no policy module for those values. The map's capacity rule therefore needs a new changeable product-policy seam rather than a database check constraint.
- The unique workspace-creator index helps a creator have one workspace, but memberships do not prevent a user from becoming active in several households. The web resolver explicitly picks the first active membership if that happens ([`resolve-scope-for-caller.ts`](../../apps/web/src/lib/resolve-scope-for-caller.ts)); this conflicts with the Phase Eight one-active-workspace promise and must become deterministic at admission/acceptance time.

### Visibility is not collaboration authority

- Most scoped records remain member-owned even at `household` scope. The current code controls who can read them, but there is no cross-domain distinction between a member-owned record shared into a household and a household-native record owned by the workspace. There is likewise no domain-by-domain rule for who may change, complete, archive, or resolve conflicts on a visible record.
- Current audience widening is explicit and well-fenced; it does not determine whether a future household member can modify an existing whole-household record. Phase Eight must keep ownership, visibility, mutation authority, and actor attribution separate instead of inferring write authority from a scope or role.
- Some domains already have helpful provenance columns; others will need an explicit workspace-native ownership representation if the later decisions choose household-native records. Reusing `ownerUserId` as a proxy for the workspace would lose the departure and historical-attribution behavior the map requires.

### Activation and product surfaces are intentionally missing

- There is no admitted route or server action for household creation, invitation delivery/acceptance, membership management, co-owner management, departure, or household settings. Existing visibility controls assume active membership exists.
- Account's Context Fact surface is Self-only, and there is no Household Context management, household home, or collaboration navigation. This is compatible with ADR 0212's dormant foundation, but it means later tickets must specify discovery, activation, empty, invited, conflict, and recovery states rather than treating the persistence model as a product flow.
- Review, Capture, Search, Today, scheduled workflows, and Eve can read or carry selected scoped records in places, but they lack an agreed household-aware product contract. In particular, the per-owner scheduler is not a workspace coordinator, and current Calendar/provider data remains individual/provider-owned.

## Consequences for the map frontier

No new child ticket is required from this inventory. The existing open decisions already cover the now-sharp work:

- [Define the Phase Eight household activation journey](https://github.com/nick-neely/tendnote/issues/356) should set the user-visible entry, account/admission, invitation acceptance, and first-workspace rules against the real dormant foundation and invitation evidence.
- [Define the Household Workspace lifecycle and governance contract](https://github.com/nick-neely/tendnote/issues/357) should define co-owner safety, seat accounting, departure, re-entry, invitation lifecycle, and recovery while preserving the useful membership/audit seams.
- Once those decisions are settled, the blocked prototype can make activation and member management concrete; household-native versus member-owned collaboration authority then becomes sharp enough to graduate from the map's cross-domain fog instead of being prematurely sliced here.
