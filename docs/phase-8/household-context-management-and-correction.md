# Household Context management and correction

Decision artifact for [Define Household Context management and correction](https://github.com/nick-neely/tendnote/issues/362). It activates the existing Household Context subject across Account, Eve, Capture, Review, and Search without turning it into a household biography, generic shared notebook, or substitute for a typed Personal OS domain.

## Product boundary

Household Context is a small set of current, broadly reusable facts that every
active Household Member may see and jointly maintain. It remains subject to the
existing Context Fact category, lifecycle, sensitivity, provenance, conflict,
and Orientation Context contracts.

A more specific Tendnote domain always wins. Plans and open questions remain
Saved Items; time-bound coordination remains an Action, Follow-Up, or future
shared-reminder domain; events remain Calendar-derived context; member-specific
facts remain Self Context; and a private thought about the household remains a
private record. `other` is not a way around that routing boundary.

## Management home

The Household Overview includes a compact **What everyone should know** section.
It shows a small useful subset and links to a focused **Manage household context**
subpage beneath Overview. Household Context does not become a fourth durable
Household navigation destination.

The focused page groups active facts by the existing fixed categories using
compact flat rows. Composition, Location, Preferences, and Constraints are
naturally prominent when present, but no category is mandatory. The page supports
add, edit, archive, sensitivity, provenance, correction, and safe undo. Archived
facts stay behind progressive disclosure.

The empty state invites one broadly useful fact, such as a general location or
durable shared preference. It does not request a complete household description,
member profiles, precise home address, minimum fact count, or setup progress.

## Shared mutation authority

Every active Household Member may explicitly add, edit, archive, restore, accept,
edit-and-accept, or dismiss Household Context. Owner status does not make one
member the arbiter of shared truth.

An explicit direct mutation takes effect immediately and records the actor,
channel, and time. The interface requires deliberate confirmation when a member:

- archives a current fact;
- explicitly replaces a newer conflicting value; or
- saves or exposes a sensitive or restricted fact to the household.

Archive is the ordinary removal path. No single member may permanently delete a
household-owned Context Fact. Active and archived Household Context follows the
Household Workspace dissolution and recovery lifecycle.

## Concurrent edits and correction

Household Context never uses silent last-write-wins behavior. A mutation carries
the version the member saw. If another member changed the fact first, Tendnote:

1. rejects the stale write;
2. preserves the member's draft;
3. shows the current statement with its last actor and time; and
4. offers **Keep current**, **Revise my change**, or an explicit confirmed
   **Replace current** action where the caller still has access.

Tendnote does not auto-merge natural-language facts. A likely duplicate or
semantic contradiction focuses the existing active fact instead of creating a
second current truth. Restoring an archived fact follows the same rule.

Authoritative Undo is available only while the exact version produced by the
member's action remains current. If another member has restored, replaced, or
otherwise changed that fact, Undo yields to the current state and requires a new
explicit action.

## Provenance and member awareness

Management and review surfaces show quiet, human-readable attribution such as
**Added by Mara** or **Updated by Alex · 2 hours ago**. Fact detail may disclose
meaningful recent versions needed for correction and undo. It is not a household
activity feed.

When a contributing member leaves or is removed, historical attribution remains
and may render as **Mara · former member**. Departure never rewrites or deletes
household-owned facts.

Ordinary Context Fact changes do not create push alerts, unread badges, inbox
counts, or proactive member notifications. An already-open page reconciles to the
authoritative state and explains when a fact changed during that interaction.

## Suggestions and evidence privacy

A Suggested Household Context Fact is one household-level review item. Any active
member may accept, edit-and-accept, or dismiss it for the household. Resolution is
global, attributed, and immediately reconciled for other members. A dismissal
suppresses the same suggestion for the household rather than creating private
per-member queues.

Suggestion evidence must already be visible to every active Household Member.
Ambient extraction from a member's private Eve conversation remains Self-only,
even when the message happens to describe the household. It must not create a
shared suggestion or expose its private evidence excerpt.

Household suggestions therefore require either:

- explicit household save or proposal intent, with the shared audience made
  clear before submission; or
- evidence from an eligible source already visible to the whole household.

Shared-channel ambient extraction remains excluded unless a later channel
contract explicitly earns a safe household-visible evidence path. Inference may
only propose; it never creates active Household Context.

## Sensitivity and audience

Household Context may use `normal`, `sensitive`, or `restricted` sensitivity only
when the statement genuinely belongs to the whole household. Saving or accepting
a sensitive or restricted statement presents a clear warning that every active
member can see it.

Normal facts may enter automatic Orientation Context. Sensitive facts may enter
only when relevant and must be phrased carefully. Restricted facts never enter
automatic orientation; they require direct, relevant current-turn intent and the
existing deliberate reveal treatment in Search or Eve.

Precise addresses, raw secrets, financial credentials, and other forbidden
Context Fact content remain rejected. A fact that should not be visible to every
member belongs in the caller's private Self Context, Saved Item, or another
appropriate private domain.

## Eve and Capture

An explicit instruction such as **Remember this for our household** may create or
correct active Household Context through the shared authenticated product
mutation. Eve and Capture repeat the Household audience when the content is
sensitive, restricted, or otherwise easy to mistake for private context.

When save intent is clear but the subject is ambiguous, Tendnote asks whether the
statement belongs in **About you** or **Household**. It does not infer the subject
from pronouns such as `we`, a current conversation topic, or active household
membership alone.

The current turn's statement wins for that response. A contradiction with durable
Household Context produces a focused correction path rather than a silent rewrite.
An accepted change is available to every active member's Orientation Context on
their next eligible Eve turn after normal invalidation.

Eve receives the caller's own Self Context and eligible Household Context, never
another member's private Self Context. Stored fact text remains delimited
untrusted data with no policy or mutation authority.

## Review and Search

Pending Household Context suggestions appear in the existing Review Queue for
every active member and in a small Suggested section on the focused management
page. They carry household-visible evidence, tentative language, and the shared
accept, edit-and-accept, and dismiss contract. They never appear in Today,
ordinary Search, Orientation Context, or ordinary Eve answers before acceptance.

Active Household Context is an exact Global Recall result available to every
active member. Results preserve the Household subject, category, sensitivity,
provenance, exact content, and a canonical link to the focused fact. Self and
Household results may coexist without conflating their subjects.

Suggested and archived facts stay out of normal results. Restricted Household
Context requires a direct Household Context request and deliberate reveal. The
first Phase Eight slice does not add embeddings or semantic Household Context
search without measured need.

## Departure, dissolution, and failure states

Departure or removal immediately revokes all Household Context access. It does
not mutate the household's active, archived, or suggested facts, and historical
actor attribution remains.

Household Dissolution cancels pending suggestions and includes active and
archived Household Context in the household-native 30-day recovery set. Recovery
restores the authoritative household state as a whole. After the window, content
is permanently deleted while only the already-approved minimized non-content
audit tombstone remains.

If membership changes during a read or mutation, the operation fails closed and
returns to Account without revealing the household's current state. Partial
Review, Search, Orientation, or cache-revalidation failure never substitutes
stale or private facts as current truth.

## Implementation boundary

This decision activates existing Context Fact subjects, policy seams, optimistic
mutation fences, provenance fields, review mutations, affected scopes, and
Orientation Context selection. It does not implement Phase Eight or prescribe a
new storage model.

No new ADR is warranted. The hard-to-reverse choice to model Self and Household
subjects in one Context Fact domain already lives in
[Context Facts are a distinct shared-subject domain](../adr/0212-context-facts-are-a-distinct-shared-subject-domain.md). This artifact supplies the reversible product and interaction contract for activating that foundation.
