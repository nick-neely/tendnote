# Household Assets and Asset Memories

Decision artifact for [Define household Assets and Asset Memories collaboration](https://github.com/nick-neely/tendnote/issues/371). It specifies how Phase Eight extends the focused Asset domain into a Household Workspace without turning it into an inventory, document manager, maintenance dashboard, or team asset system.

An Asset remains a practical thing Tendnote tracks over time: an appliance, vehicle, subscription, service, property, or kept item. Asset Memories, evidence, Related Asset Links, related Actions, and history remain typed parts of that record rather than independent generic documents. Assets retain their fixed kinds and active/archive lifecycle; a household does not gain quantities, stocktaking, component trees, vendor management, budgets, purchase workflows, or a shared file library.

## Two ownership forms

Phase Eight separates who owns an Asset from who may see it. Widening visibility never transfers ownership.

### Member-owned Asset shared into a household

A member may deliberately share an Asset with selected active Household Members or the whole household. It remains their Asset: only the owner may rename it, change its kind or audience, edit its member-owned Asset Memories, evidence, and links, archive or restore it, or use a correction/privacy deletion path for their own records. Other authorized members may read and search the Asset and its deliberately visible children, follow its links, and choose a Reminder Schedule for a currently visible linked Action; they cannot mutate the Asset or its member-owned child record.

This is useful for “my vehicle you may refer to” or “my service you should know about,” not for handing the thing itself to the household. The owner may explicitly, confirmably create a household-native replacement or convert the Asset through the eventual canonical owner-only flow. That action states that the workspace will own the result and that it remains after the member leaves. It has no claim-back path.

### Household-native Asset

A **household-native Asset** belongs to the Household Workspace itself: the refrigerator, shared home service, or jointly maintained household property. It is whole-household-visible by definition and uses the established workspace-owner representation rather than an absent or repurposed member owner.

Every active Household Member has symmetric authority to create, edit, archive, restore, and maintain a household-native Asset and its household-native child records. Household Owners and the creator have no extra content authority. Archive is the ordinary removal path; no individual member may permanently delete a workspace-owned Asset. It stays with the workspace through departure, removal, and dissolution recovery, keeping creator and actor attribution.

## Memories, evidence, links, and maintenance

An Asset’s visibility is a ceiling, not an automatic widening of every child. Asset Memories, evidence, and Related Asset Links may be narrower than their parent Asset, and every read independently checks the child’s ownership form, audience, sensitivity, lifecycle, and current membership.

- A household-native child is jointly maintained, household-visible, and uses workspace retention. Every active member may add, correct, archive, or restore it, subject to the same concurrency and sensitivity checks as the Asset.
- A member-owned child may attach to a household-visible Asset while remaining private or deliberately shared with a narrower audience. Its owner alone changes its content, audience, lifecycle, or uniquely owned evidence. A parent link must never expose the child’s content, existence, search match, count, or explanation to an unauthorized member.
- Evidence stays immutable and source-grounded. Editing an Asset or Asset Memory never rewrites evidence, and no member may expose, rewrite, or delete another member’s evidence. Reusing visible evidence follows the established impact-disclosure path; household-native evidence follows workspace retention rather than one member’s deletion choice.
- Related Asset Links remain lightweight and typed, not a hierarchy or inventory graph. They may be created only when both endpoints and the link itself are authorized for the acting member; a link never broadens either endpoint’s visibility.
- Maintenance remains an Action or Routine concern. An Asset may contextualize a related Action, and authorized members interact with that Action under its own ownership, authority, occurrence, Responsibility Holder, and reminder rules. An Asset does not itself assert that someone is responsible, complete work, or carry its own reminder schedule.

## Capture, Review, Eve, and Search

Private Eve and Capture stay private even when a member discusses a shared home or practical thing. They cannot create, propose, or signal a household Asset merely because the content sounds shared.

An explicitly authorized Household-scoped Eve or Capture flow supplies deliberate household context. It may create a household-native Asset only for clear user intent, and it routes Asset Memories, inferred details, duplicate candidates, evidence, and inferred links through the existing review-gated, source-grounded Asset flow. A shared proposal is one household Review item; any active member may accept, edit-and-accept, or dismiss it, with quiet attribution and immediate reconciliation. Inference may produce a shared proposal only from evidence already visible to the whole household. A proposal never exposes a private Source Record or implies that one exists.

Eve, Capture, Review, and Search call the same typed permission boundary as the canonical Asset surface. Search returns only current authorized Assets and Asset Memories, preserving ownership, scope, source grounding, lifecycle, and restricted-content treatment. Private or inaccessible records produce neither a result, count, explanation, nor existence signal. Archived records require an explicit archived-record request.

## Household, Today, reminders, and provenance

The dedicated Asset surface and Asset Profile remain the authoritative home for Assets, memories, evidence, links, related Actions, history, and review. The shared Household home does not become an inventory or maintenance dashboard: it may surface a small, otherwise eligible linked Action with factual Asset provenance, but it does not surface a bare Asset or Asset Memory as a coordination item. Private Today likewise admits only an independently eligible related record; a bare Asset or Asset Memory never creates a personal backlog.

Reminder Schedules remain a member’s own explicit choice on an eligible linked Action or Routine. Asset creation, sharing, editing, review, maintenance, archive, or lifecycle changes never enroll another member’s device. Asset changes revalidate related authorized readers and Action subscriptions without manufacturing a maintenance occurrence or notification.

Household-native Asset and child writes use optimistic concurrency. On a stale write, Tendnote preserves the member’s draft, shows the current value and last actor, and requires keeping, revising, or explicitly replacing the draft; it never silently last-write-wins or attempts a natural-language merge. Attribution is quiet and factual — **Household**, **Shared by Mara**, **Added by Ana**, **Last changed by Ben** — never an activity feed, comment thread, member-status display, maintenance log, or fairness record.

## Departure, removal, and dissolution

Departure or removal immediately revokes Household access, member-owned sharing, and the departing member’s schedules for linked records. A member-owned Asset and its member-owned children return to the owner’s private space; other members lose access. A departing non-owner simply loses access to household-native Assets and their children, while their historical creator and actor attribution remains.

Household-native Assets, household-native child records, and their authorized history remain with the workspace. Household Dissolution immediately ends access and cancels affected Reminder Schedules, then places household-native Assets and their workspace-owned children into the established 30-day recovery set before the retention and deletion lifecycle completes. Private member-owned children never enter that recovery set.

## Implementation boundary

The current Asset seam is member-owned and must not be widened through visibility checks. Phase Eight needs an explicit workspace-owner representation and a focused Asset household-collaboration query/mutation boundary that applies ownership form, current membership, child-scope ceilings, evidence authorization, versioned writes, provenance, lifecycle, and Action/reminder composition before any Asset Profile, Household, Today, Eve, Capture, Review, Search, or background adapter calls it.

The exact tables and migration sequence belong to the separate implementation-ticket pass. The resulting implementation must preserve the existing narrow Asset domain and its review-first, evidence-minimized trust model.
