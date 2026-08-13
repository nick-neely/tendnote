# Household Relationship Records and Privacy

**Status:** Accepted Wayfinder decision  
**Decision ticket:** [Define household relationship-record collaboration and privacy](https://github.com/nick-neely/tendnote/issues/372)

## Decision summary

Phase Eight keeps People and every person-centered relationship record
member-owned. Household collaboration may expose one deliberately selected
Memory, Source Record, or Follow-Up through a read-only **Relationship Share**,
but it never creates a Household Person, merges members' People, transfers
record ownership, or lets another member edit relationship history.

When a household-native coordination record needs to name an external person,
it stores a minimal, record-local **Person Reference**. The reference is a label
an authorized member deliberately supplied for that coordination record. It is
not a contact, profile, identity match, or permission-bearing link to a private
Person record.

## Ownership and authority

| Record | Ownership | Sharing | Authorized audience behavior |
|---|---|---|---|
| Person | The member who created it | Never becomes a Household record | No access through another member's Person record |
| Memory | Its member owner | Explicit selected-member or whole-Household Relationship Share | Read only; the owner alone edits, archives, changes audience, sensitivity, evidence, or Person links |
| Source Record | Its member owner | Explicit and independent Relationship Share | Read-only evidence; sharing it reveals no linked private Memory or Person |
| Follow-Up | Its member owner | Explicit selected-member or whole-Household Relationship Share | Read only; the owner alone changes lifecycle, timing, audience, reminder, or Person links |
| Person Reference | The household-native record that contains it | Inherits only the containing record's visibility | Members use the containing domain's authority; the reference grants no relationship-record access |

`shared` names specific active Household Members. `household` means every active
member of the one active Household Workspace. Choosing either is an explicit
audience decision; widening visibility never transfers ownership. Household
Owner status adds no relationship-record authority.

Another member who needs mutable shared coordination creates or links the
appropriate household-native Action, Event Plan, Gift Plan, Saved Item, or
other canonical domain record. Tendnote does not add comments, corrections,
assignments, or co-editing to a member-owned relationship record.

## Identity without a shared contact database

Members may keep separate private People for the same external person. Tendnote
does not match, merge, rank, deduplicate, or reveal those records across member
boundaries. A Relationship Share carries the deliberately exposed record plus a
safe display label; it does not expose the owner's Person profile, contact
methods, birthday, relationship type, other records, or even the existence of
additional context.

A Person Reference is created only through an explicit authorized action on its
containing household-native record. A Household Calendar event may prefill a
label during confirmed Event Plan creation, but attendee or provider data never
silently creates a Person, Person Reference, Memory, Source Record, or Follow-Up.
Changing or removing the reference follows the containing record's authority
and conflict rules.

## Evidence, sensitivity, and provenance

Every relationship record is shared independently. A shared Memory never
reveals its Source Record by implication; when its evidence remains private, the
audience sees only that it is the owner's reviewed Memory. A shared Source
Record never reveals linked private Memories or People. Inaccessible evidence,
records, and People leave no result, count, citation, explanation, or other
signal that they exist.

Sensitivity remains independent from visibility. Sharing restricted content
requires a second confirmation that names the audience and explains that every
selected active member can read it. Restricted relationship context is excluded
from Orientation Context, Household composition, proactive suggestions,
ambient retrieval, reminder previews, and notifications. An authorized member
may retrieve it only through a direct, targeted request that names the relevant
subject or record.

The audience sees quiet factual provenance such as **Shared by Mara**, the
record's trust treatment, and relevant recorded or reviewed time. The share
decision, audience changes, and owner mutations are audited. Source Records
remain immutable evidence. Owner edits use the existing optimistic-concurrency
contract; stale owner drafts are preserved for reconciliation, while read-only
audiences simply refresh to the current authoritative version. This does not
create a Household activity feed or relationship-history ledger.

## Surface contract

### Eve, Capture, and Review

Private Eve and Capture remain private even when a member says `we`, discusses
the household, or names another Household Member. Sharing requires an explicit
record and audience choice. An authorized Household-scoped flow may help the
member choose a Person Reference or propose the relevant household-native
coordination record, but it cannot infer access to the member's People graph.

Relationship Review remains controlled by the record owner. A proposal may be
visible to its proposed audience only when all material evidence is already
visible to that exact audience; the owner remains the only member who may
accept, edit-and-accept, or dismiss a proposal that produces or changes a
member-owned relationship record. Private evidence is never quoted or signaled
in a shared Review state.

### Search and Eve recall

Search, Exact Recall, Semantic Retrieval, the Relationship Agenda, and Eve use
the same deterministic caller, membership, audience, sensitivity, lifecycle,
and evidence checks. A visible foreign-member record returns its safe display
label and factual sharing provenance, not a join to the caller's or owner's
private Person. Exact names do not authorize cross-member Person matching.

Raw Source Records remain evidence rather than an independent Global Recall
result family. When a shared Source Record grounds an authorized relationship
result, its citation or canonical evidence link is available only to the same
audience. Generated summaries never become shared relationship truth.

### Household and private Today

Memories and Source Records never become standalone Household cards, a people
feed, or a shared relationship dashboard. They may ground an authorized
Household-native coordination record or answer a direct authorized request.

A shared active Follow-Up may appear in Household **Ready now** or
**Coming up** only when its ordinary deterministic timing makes it eligible. It
is labeled **Shared by <member>**, remains read only to the audience, and offers
no audience mutation inline. It appears in private Today and reminder delivery
only for its owner under the existing Follow-Up rules. Visibility never creates
another member's personal work, reminder schedule, notification, or device
enrollment.

### Calendar handoff

A personal Calendar connection remains owner-scoped and cannot supply Household
relationship context. A Household Calendar event is shared provider context,
not a relationship record. An authorized member may explicitly copy only a
minimal person label into a Person Reference on a Household Event Plan. The
provider event never creates or widens People, Memories, Source Records, or
Follow-Ups, and Google remains the event source of truth.

## Departure, removal, and dissolution

Departure or removal immediately revokes the departing member's Relationship
Shares, audience grants, canonical links, cached reads, and pending delivery.
When the record owner leaves, their shared relationship records return to their
private space. When an audience member leaves, that member alone loses access.
No member-owned Person, Memory, Source Record, Follow-Up, private evidence, or
share history enters Household recovery or remains available to former members.

Household-native coordination records retain their record-local Person
References, actor attribution, and normal domain history because those records
belong to the workspace. Dissolution ends access and delivery immediately and
places eligible household-native records and their Person References in the
established 30-day recovery set. Recovery never reconstructs or links a
departing member's private People graph.

## Explicit exclusions

- A Household People, contacts, address-book, or relationship-history database
- Cross-member Person matching, merging, duplicate review, or identity graph
- Household-native Memories, Source Records, or Follow-Ups
- Shared editing, comments, mentions, corrections, or approval of another member's relationship records
- Sharing inferred from `we`, shared-sounding content, Calendar attendees, or Household membership
- Automatic evidence expansion, proactive restricted-content use, or inaccessible-record leakage
- Another member's Today item, reminder, notification, or device enrollment from visibility alone
- CRM pipelines, relationship scoring, engagement analytics, or autonomous outreach

## Existing seam implications

The current schema already keeps People owner-scoped and gives Memories, Source
Records, and Follow-Ups owner identity plus Household visibility rails. The
implementation pass should preserve that model, enforce record-specific share
authority through small owner-scoped product functions, and introduce the
smallest domain-specific representation needed for a safe Person Reference.

Visible foreign-member relationship results cannot depend on joining the
caller's private Person row. Their typed result envelope must instead carry the
deliberately exposed display label and provenance while keeping every private
Person field and inaccessible related-record count absent. Phase Eight should
extend the current fail-closed visibility and two-member isolation tests across
Capture, Review, Search, Eve, Household, Today, Calendar handoff, departure,
removal, and recovery.
