# Household Saved Items

Decision artifact for [Define household Saved Items collaboration](https://github.com/nick-neely/tendnote/issues/370). It specifies how Phase Eight extends the narrow Saved Item fallback into a Household Workspace without turning it into a shared inbox, document system, task list, checklist, tag collection, comment thread, or generic collaboration record.

Saved Items remain only source-grounded `note`, `link`, and `open_question` records. They retain their active/archive lifecycle, optional bring-back timing, and explicit promotion into a more specific supported domain. A Saved Item never replaces a Person, General Action, Asset, Calendar event, Gift Plan, or Household Context.

## Two ownership forms

Phase Eight separates who owns a Saved Item from who may see it. Visibility never transfers ownership.

### Member-owned Saved Item shared into a household

A member may deliberately share their Saved Item with selected active Household Members or the whole household. It remains **their** record: the owner alone may edit its content or timing, change its audience, archive, restore, resolve it, promote it, or delete uniquely owned private evidence. Other authorized members may read, search, and set a Reminder Schedule for themselves, but may not alter the item, its evidence, or its lifecycle.

This is useful for “my note you should be able to see,” not for handing a note to the household. Widening its audience changes visibility only. If its owner leaves or is removed, it immediately returns to their private space; other members lose access and their own schedules for it.

### Household-native Saved Item

A **household-native Saved Item** belongs to the Household Workspace itself. It is a whole-household-visible shared fallback such as a link everyone needs, a household note, or a question the household wants to bring back together. It uses the existing household-native ownership form; it is not represented by an absent or repurposed member owner.

Every active Household Member has symmetric authority to create, edit, archive, restore, resolve an open question, and promote a household-native Saved Item. Household Owners and the creator have no extra content authority. Archive is its removal path: no individual member may permanently delete a workspace-owned item. The item survives member departure, removal, and dissolution recovery with creator and actor attribution intact.

There is no conversion-by-visibility and no claim-back path. A member-owned item remains member-owned when shared. Its owner may instead choose an explicit, confirmed household-native action during promotion; that acknowledgement states that the new Action belongs to the workspace and will remain after the member leaves.

## Capture, review, grounding, and promotion

Private Eve and Capture remain private by default. Talking about a partner, home, or shared concern in a private conversation does not create or expose a Household record.

An authorized Household-scoped Eve conversation or Capture flow is different: it supplies the deliberate household context, so Eve may interpret ordinary language as a household-native Saved Item without requiring a special keyword. The resulting confirmation says **Saved for Household**, identifies its source grounding, and offers Change and Undo if the member wants a different destination or private scope.

Each Saved Item remains linked to immutable Source Record evidence. A household-native item has whole-household-visible evidence. A member-owned item exposes evidence only when its owner deliberately shares it with the same authorized audience. Editing the item never rewrites evidence, and no member may make someone else's evidence visible, rewrite it, or delete it. Shared or reused evidence uses the existing impact-disclosure path; household-native evidence follows workspace retention, never one member's unilateral source-deletion choice.

Inference is stricter than explicit Household capture. Evidence already visible to the whole household may produce one household Review proposal; any active member may accept, edit-and-accept, or dismiss it with attribution and reconciliation. Private-channel ambient inference stays private, even if the text describes a household, and it cannot produce a shared proposal or existence signal.

Promotion is explicit and creates the destination's correct ownership form:

- The owner of a member-owned Saved Item may promote it into their own member-owned Action, retaining only the audience they explicitly confirm.
- That owner may instead explicitly choose **Give to the household**. This creates a household-native Action and archives the member-owned Saved Item as resolved; it is a new, confirmed workspace-owned destination, not an implicit transfer of the Saved Item itself.
- Any active member may promote a household-native Saved Item only into a household-native Action.

Every promotion preserves source links, is idempotent, records quiet provenance, and archives the originating Saved Item as resolved. It never turns a link, note, or open question into a task automatically.

## Household, Today, reminders, and assisted surfaces

Authorized active Saved Items compose into the deterministic, read-first **Ready now** and **Coming up** sections of Household when their bring-back timing makes them relevant. A household-native item is labelled **Household**; a member-owned one is labelled **Shared by <member>**. Selected-member sharing can create legitimate per-member differences, but inaccessible records produce no item, count, explanation, or existence signal.

Private Today remains individually relevant rather than a second Household queue. An authorized Saved Item reaches a member's Today only when its usual due or deterministic resurfacing rule applies and that member either owns the item or holds their own Reminder Schedule for it. A shared note with no individual opt-in sits on Household and nags nobody privately.

Each active member who can currently see an item may choose their own Reminder Schedule for it. A schedule belongs to the subscribing member and alerts only that member's opted-in devices. Creating, sharing, editing, archiving, restoring, resolving, or promoting an item never enrolls anyone else; changes revalidate and regenerate affected subscribers' pending intents, and departure, removal, or lost visibility immediately revokes them.

Eve and Search read only authorized active Saved Items and retain source, scope, and lifecycle framing. Capture reaches the same domain mutation layer. Review uses the shared-proposal rule above. Raw Source Records remain grounding rather than an independent Household result family, and archived items require an explicit archived-record request.

## Conflicts, provenance, and end of life

Household-native writes use optimistic concurrency. A stale member keeps their draft, sees the current value and last actor, and must keep, revise, or explicitly replace it; Tendnote never silently last-write-wins or attempts a natural-language merge. Attribution is quiet and factual — **Household**, **Shared by Mara**, **Created by Ana**, **Last changed by Ben** — not an activity feed, comment thread, mention system, performance record, or fairness ledger.

Member-owned shared items retain their owner's lifecycle and return private on the owner's departure, removal, or Household dissolution. A departing non-owner immediately loses access and their schedules, while their lack of mutation authority means no shared item content is transferred or stranded.

Household-native Saved Items remain with the workspace on any member's departure or removal, retaining historical attribution. Household Dissolution immediately ends member access and schedules, then places the items and their evidence in the established 30-day recovery set before the workspace retention/deletion lifecycle completes.

## Implementation boundary

The current Saved Item seam is member-owned: `owner_user_id` is required, while `household_id` is only a visibility anchor. Phase Eight needs an explicit workspace-owner representation for household-native Saved Items, separate member-authority and visibility predicates, versioned household-native writes, subscriber-scoped Reminder Schedules, and source-evidence checks before adapting Household, Today, Eve, Capture, Review, Search, and background work.

The existing owner-scoped lifecycle functions and owner-only promotion must not be widened by a visibility check. The implementation should introduce a small Saved Item household collaboration query/mutation boundary that applies ownership form, current membership, audience, evidence scope, optimistic concurrency, provenance, and lifecycle before any surface calls it.
