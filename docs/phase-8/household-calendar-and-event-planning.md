# Household Calendar and event planning

Decision artifact for [Define household family and social event tracking against
Calendar provider truth](https://github.com/nick-neely/tendnote/issues/369). It
defines the Phase Eight contract for a deliberately shared Google Calendar and
the focused Tendnote-native planning that can grow around it. It does not
implement a calendar client, invitation system, RSVP product, shared scheduling
tool, or generic social feed.

## Two deliberately different things

A **Household Calendar Connection** is an explicit, Household Owner-governed
designation of one Google Calendar for the entire Household Workspace. An Owner
connects it through a Google account and confirms plainly that every current and
future active Household Member may read its events in Tendnote. The credential
holder is a technical connector only; it gains no special authority over the
calendar's Tendnote surfaces or the planning records that refer to it. An active
member need not connect a personal Google Calendar to read an authorized
Household Calendar.

A member's personal Calendar connection stays owner-scoped. Tendnote never
promotes its events into the Household merely because an event looks shared,
has other attendees, or concerns the home. A household may designate more than
one suitable Calendar, but each connection gets the same whole-household
confirmation; there is no per-event audience selector or inferred sharing.

A **Household Calendar Event** is a minimized, read-through provider result:

- Google Calendar is its sole event authority, including title, time, attendees,
  RSVP state, cancellation, and any reminders Google sends.
- Tendnote reads bounded summaries, identifies them as Calendar-derived, and
  reports whether they are live or stale. It never writes, syncs, mirrors,
  creates, edits, deletes, RSVPs to, or schedules provider events.
- Provider attendee and response details are read-only context, never Tendnote's
  own attendance, guest-list, availability, or participation truth.

This preserves the existing minimized, short-lived Calendar read boundary while
making its authorized audience the active Household rather than an individual
owner. The irreversible privacy decision earns [ADR 0217](../adr/0217-household-calendars-are-explicit-read-only-workspace-connections.md).

## A household-native Event Plan, not a mirror

A **Household Event Plan** is a household-native Tendnote record for the
coordination around an occasion. It may be created directly from explicit
household intent or from a member explicitly choosing **Plan this event** on a
Household Calendar Event. It may also exist without a Calendar reference.

The Plan is a companion, not a duplicate. It can retain Tendnote-native planning
content and may reference one selected provider event, but it does not copy that
event into a second authoritative timeline. A changed, cancelled, or unavailable
provider event remains provider context; members decide whether their Plan needs
updating. A Plan is active until it is archived. Archive is its removal path;
no individual member may permanently delete a workspace-owned Plan.

Plans may link existing records without collapsing their meanings:

- a Person or birthday occasion can explain whom an event concerns, but neither
  changes the Person's birthday fact or grants access to private relationship
  context;
- household-native or appropriately authorized Actions and Follow-Ups may carry
  the actual work, while completing one never changes the Calendar event or Plan;
  and
- Household Context can inform a Plan, but remains shared orientation rather
  than event-feed content.

There is no Tendnote RSVP, availability poll, guest list, per-member attendance,
turn order, or scheduling state. A member-authored Plan note is just a note; it
does not claim that someone will attend or that Google is wrong.

## Authority, reconciliation, and provenance

Every active Household Member has symmetric authority to create, edit, and
archive a Household Event Plan. The Plan's creator and Household Owners have no
additional content authority. Material writes use the established optimistic
concurrency contract: a stale member's draft is preserved, the current value
and its actor/time are shown, and the member must keep, revise, or explicitly
replace the draft. Tendnote never silently last-write-wins or attempts a
natural-language merge.

Provenance is quiet and factual: creator, last actor, and time on a Plan; source
Calendar and freshness on a provider event. It is not an activity feed, comment
thread, member-status display, or attendance ledger. Only Household Owners may
connect or disconnect a Household Calendar Connection because doing so changes
whole-household visibility.

## Household, Today, reminders, and assisted surfaces

The shared **Household** home is the read-first place for a bounded chronological
view of upcoming Household Calendar Events and active Event Plans, composed
inside the already-settled deterministic caps and domain links. A Calendar event
is visibly provider-derived; a Plan is visibly household-native. One failing
Calendar family cannot hide successful Calendar families or Plans.

Private **Today** may surface a same-day or preparation-window shared Calendar
event or Event Plan only when deterministic policy makes it relevant to that
member, and it carries a Household label. Household visibility does not create a
second shared Today or opaque ranking.

Google controls its own event notifications. Tendnote never sends an ambient
alert simply because a member can see a Household Calendar Event or Event Plan.
If a member wants a Tendnote reminder, they explicitly create or accept a linked
Action or Follow-Up and choose their own Reminder Schedule; that schedule alerts
only that member's devices.

Any active member may ask Eve to read the Household Calendars visible to them.
Eve labels the result as Calendar-derived and live or stale. It may suggest an
Event Plan, but a scan or inference never creates one; an explicit instruction
such as "make a household plan for Saturday's school event" may create one
through the same authorized product mutation as the canonical surface. Search
returns current authorized Household Calendar Events as read-through results and
Event Plans as durable household records, preserving source and freshness.
Private Calendar data, raw provider payloads, and inaccessible household records
produce neither a result nor an existence signal.

## Freshness, loss of access, and end of life

Household Calendar reads use the existing short-lived minimized cache only under
its live/stale rules. A stale result says so; it never drives a new Plan or
reminder. A disconnected or failing Calendar stays unavailable rather than
falling back to a member's personal Calendar, and it never hides another
authorized Calendar or an existing Event Plan.

If the credential-holding member leaves or is removed, the affected Household
Calendar Connection becomes unavailable immediately and its provider cache is
cleared. The former member loses all Household access immediately. Existing
Event Plans stay with the workspace, retain historical attribution, and show an
unavailable provider reference where applicable; they do not retain cached
provider content as a substitute.

On Household Dissolution, every Household Calendar Connection is disconnected
and its provider cache cleared. Household Event Plans follow the established
household-native 30-day recovery and deletion lifecycle, while no Calendar
connection or provider event remains available through Tendnote.

## Implementation boundary

Implementation needs an owner-governed Household Calendar Connection seam that
admits the active Household before it exposes any provider-derived result,
records the connector without conferring record authority, and clears every
connection cache on disconnect, connector departure, removal, or dissolution.
It also needs one household-native Event Plan query/mutation layer that applies
member authority, concurrency, provenance, typed links, and lifecycle before
Household, Today, Eve, Capture, Review, Search, and reminder adapters compose it.

The existing owner-scoped Calendar reader must not be widened implicitly: its
new household path needs its own authorization and cache identity. The exact
schema and provider-token representation are implementation-ticket decisions,
provided the contract above remains true.
