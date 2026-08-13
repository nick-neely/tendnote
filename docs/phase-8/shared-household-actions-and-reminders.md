# Shared Household Actions, Routines, and reminder coordination

Decision artifact for [Define shared Household Actions, Routines, and reminder
coordination](https://github.com/nick-neely/tendnote/issues/366). It defines the
first Personal OS domain to earn a full Phase Eight collaboration contract, and
so it is also the first concrete instance of the map's household-native versus
member-owned distinction.

It specifies ownership, authority, lifecycle, recurrence, responsibility, ambient
reminders, conflict, provenance, composition, and end-of-life for household
Actions and Routines. It does not implement Phase Eight and does not generalize
its answers to gifts, events, assets, or any other domain, each of which owes its
own contract.

## Two ownership forms

Phase Eight separates **who owns a record** from **who can see it**. Household
visibility never transfers ownership.

### Household-native Action or Routine

Owned by the Household Workspace itself. This is the shared chore, the joint
errand, the recurring obligation that belongs to the home rather than to a
person: bins out on Tuesday, replace the water filter, renew the parking permit.

- It is visible to every active Household Member by definition. Selected-member
  subsetting of a workspace-owned record is not supported in Phase Eight.
- Every active member has symmetric authority over it (see below).
- It survives any member's departure or removal, with historical attribution
  intact.
- Its creator provenance is preserved, but its creator holds no privileged
  authority over it.

### Member-owned Action shared into the household

Owned by one member, deliberately made visible at `shared` or `household` scope.
This is "my errand, which you can see": my dentist appointment, my side of a
split task, something I want a partner aware of without handing it over.

- Its owner remains its sole author.
- It reverts to `private` when its owner leaves the household or when the
  workspace dissolves.

### Choosing and converting

Creation asks one question — who this is for — offering **Just me**, **Shared
with selected members**, and **Our household**. Choosing **Our household** at
creation produces a household-native record, because that is what a shared chore
almost always means.

Widening an existing member-owned Action to household scope changes visibility
only; it never silently transfers ownership. Handing a record over is a separate,
explicit, confirmed action available only to its owner, which states plainly that
the record will stay with the household if the owner leaves and that other
members will be able to edit it.

Phase Eight supports member-owned to household-native conversion only. There is
no claim-back path, because reversing ownership would require deciding which
member wins a record the workspace owns. A member who wants a private version
archives the household-native record and creates their own.

## Authority

Authority is per ownership form. It is never inferred from role: Household Owner
status grants no additional authority over an Action, exactly as it grants none
over Household Context.

| Operation | Household-native | Member-owned, shared or household scope |
| --- | --- | --- |
| Create | any active member | owner only |
| Edit title, notes, due date, links, Area, asset hints | any active member | owner only |
| Change recurrence, pause, resume | any active member | owner only |
| Complete, reopen | any active member | any authorized member |
| Skip an occurrence | any active member | owner only |
| Defer or resurface | any active member | owner only |
| Archive, dismiss | any active member | owner only |
| Set or clear the Responsibility Holder | any active member | not available |
| Change visibility or audience | not applicable | owner only |
| Permanently delete | nobody | owner only |

Two consequences deserve to be called out.

**This tightens current behavior for member-owned records.** The shipped
lifecycle seam lets any member who can see a scoped Action take any lifecycle
action on it, including dismiss and archive. Phase Eight narrows that to the
reversible progress actions — complete and reopen — because "I picked up the
milk" is a truthful, reversible report about someone else's record, while "I
archived your errand" is a decision that was never theirs. Deferral, skipping,
dismissal, archiving, and re-authoring return to the owner.

**Archive is the removal path for household-native records.** No single member
may permanently delete a record the workspace owns, mirroring the Household
Context contract.

## Recurrence and occurrences

A household-native Routine has exactly **one authoritative current occurrence**
for the whole household. There are no per-member occurrences, no per-member due
dates on one occurrence, and no per-member completion state.

- Completing or skipping the current occurrence advances it once for everyone and
  records the acting member in history.
- Advancement is fenced on the occurrence the member acted against. A concurrent
  or stale advance does not roll forward twice: it reconciles and explains that
  the occurrence was already handled and by whom.
- Pausing suppresses the shared occurrence, removes the Routine from the
  Household home and from every member's Today, and invalidates every member's
  pending reminder intent for it. Resuming materializes the next valid future
  occurrence and each subscribed member's own schedule rule, without firing a
  catch-up alert for a moment that has passed.
- Archiving a household-native Routine ends its occurrences for the household.

Skipping means "not this time." It advances the occurrence and records a
`skipped` history event with its actor. It is not a completion and is never
presented as one.

## The Responsibility Holder

A household-native Action or Routine may name at most one active Household Member
as its **Responsibility Holder** — the member who is looking after it. It answers
"who's got this?" for a couple or a small trusted circle, and it is deliberately
a member's statement rather than the product's claim.

That distinction carries the whole design. When a member names the holder,
Tendnote is reporting what that member said. If Tendnote instead advanced a turn
order by itself, it would be asserting whose turn it is — a claim about the past
that it cannot actually know, because it cannot see a partner quietly covering,
work done outside Tendnote, or a swap the members agreed between themselves. A
wrong assertion of that kind becomes durable, timestamped evidence in a
disagreement, and manufacturing that is precisely what a private household
notebook must not do.

The following constraints are part of the decision rather than implementation
detail:

- **Only household-native records carry a holder.** A member-owned record already
  has an owner, and ownership is not a statement about who does the work.
- **A holder is optional, and no holder is the ordinary case.** An unnamed record
  is simply the household's, which is a legitimate and common answer.
- **There is no turn order and no automatic advancement.** Completing or skipping
  an occurrence leaves the holder exactly as it stands. Tendnote never moves a
  name on its own initiative.
- **The holder never gates authority.** Any active member may complete, skip,
  edit, pause, or defer a household-native record regardless of who is named, and
  history records the real actor independently of the holder.
- **No ledger of any kind.** Tendnote stores no completion tallies, streaks,
  missed-turn state, fairness score, or balance between members. ADR 0165 stands:
  history without productivity analytics.
- **Never inferred.** Tendnote does not name, change, or suggest a holder from who
  usually completes the record. A holder is an explicit member edit.
- **No personal backlog.** The holder produces no "my chores" queue, no per-member
  default filter on the Household home, and no assignment inbox.

### Handing off

Completing or skipping an occurrence of a household-native record offers a
one-tap hand-off to another active member, in place, at the moment the question
naturally arises. It is an explicit act by the acting member, recorded with its
actor like any other change, and declining leaves the holder as it stands.

This is what keeps an alternating chore seamless without storing a sequence. The
settled chore — the common case, where one member simply always does it — is
named once and never touched again, which a turn order could only have expressed
as a sequence of one.

Tendnote accepts the consequence that a household which forgets to hand off will
leave one name in place while both members drift into sharing the work
informally. The alternative is a product that asserts an alternation it never
observed.

Holder changes are ordinary collaborative writes under the same optimistic
concurrency fence as any other household-native change. When the named member
departs or is removed, the holder is cleared and Tendnote chooses no replacement.

## Ambient reminders

**A Reminder Schedule stays one member's own choice about their own devices.**
ADR 0203's invariant — shared visibility never enrolls another owner — is
preserved and is the reason the reminder contract looks the way it does.

- Each member may set at most one Reminder Schedule per record they can currently
  see, household-native or member-owned. `reminder_schedules` is already keyed on
  the subscribing user and the record, so several members may each hold their own
  schedule for one shared Routine and both partners can be reminded about bin
  day.
- The schedule's user is the **subscribing member**, not the record's owner. The
  current owner-equality check becomes a current-visibility and authority check.
- **No member action ever creates an alert on another member's device.** Nobody is
  auto-enrolled by being named as Responsibility Holder, by a record being shared
  with them, or by a household-native record being created.

### The holder offer

When a household-native record names a Responsibility Holder who has no schedule
for it, Tendnote offers that member — once — to add their own Reminder Schedule.

- The offer appears in that member's own product surfaces. It is never itself a
  push notification, because an unconsented alert is exactly what this contract
  refuses.
- Accepting stores that member's ordinary Reminder Schedule for the record. Because
  the holder does not rotate, no occurrence-conditional schedule rule is needed.
- Declining is remembered for that record and is not re-offered.
- The schedule remains that member's own to keep or remove. Handing the record to
  another member offers, in the same confirmation, to remove the outgoing member's
  reminder — an explicit choice about their own device, never a silent mutation.
- Departure or removal revokes the schedule entirely.

### Delivery, freshness, and invalidation

Existing reminder mechanics apply unchanged: device-scoped preview policy,
installation-scoped opt-in, per-installation fan-out, freshness windows measured
from the intended time, and no catch-up alert for a lead time that has already
passed.

One behavior is genuinely new: **another member may now be the cause of an
invalidation.** A completion, skip, pause, archive, or recurrence change by any
authorized member invalidates every subscribed member's pending intent for the
affected occurrence and deterministically regenerates the replacement where one is
still warranted. The dispatcher already reloads
authoritative owner-visible state immediately before every send; the new
requirement is that it must also revalidate current membership and current
visibility, so a member who left never receives an alert about a household record
they can no longer see.

Stale suppression remains delivery state only. It never mutates the backing
record, never advances an occurrence, and never changes a Responsibility Holder.

## Conflict, provenance, and attribution

Household-native records use optimistic concurrency rather than
last-write-wins, matching the Household Context contract. A stale write preserves
the member's draft, shows the current value and the last actor, and requires the
member to keep, revise, or explicitly replace it.

Progress actions are reconciled rather than draft-preserved: a stale completion
reports that the occurrence was already handled, by whom, and when, then settles
on authoritative state. It never double-advances and never silently discards the
other member's outcome.

Every change records its actor in the existing lifecycle history, and the record
carries its last actor. Because a household-native record has no member owner,
every surface that attributes authorship must read creator provenance rather than
ownership.

Attribution stays quiet and factual — **Household**, **Shared by Mara**, **Ana is
looking after this**, **Completed by Ben** — and never becomes an avatar-heavy
activity feed, a mentions system, or a comment thread.

Historical attribution survives departure, removal, and dissolution-recovery.

## Suggested Actions in a household

A Suggested General Action may propose a household-native record only when its
evidence is already visible to the whole household. It then appears as one shared
review item in every active member's Review Queue, and any active member may
accept, edit-and-accept, or dismiss it for the household with attribution and
immediate reconciliation for the others.

Private-channel ambient extraction stays member-owned and private. Tendnote may
never expose one member's private evidence by proposing a household record from
it, even when the content plainly describes the household. Explicit household
intent is always available instead.

Suggestions are not household coordination content until accepted: they stay in
Review, out of the Household home, out of Today, and out of ordinary Eve answers.

## Composition into Household and Today

**Household home.** Household-native and member-owned shared Actions and Routines
both compose into the existing capped **Ready now** and **Coming up**
sections under the already-decided deterministic eligibility, ordering, and caps.
Scope and holder appear as quiet text labels. The home applies no default filter
to the current member's records. Its inline actions are limited to completion and
reopening, which are reversible and already authorized; skipping, deferring,
pausing, archiving, and holder changes link to the record.

**Private Today.** Household visibility alone does not make a record personally
relevant. A household-visible Action or Routine becomes Today-eligible for a
member only when it is due, overdue, or deliberately resurfaced **and** at least
one positive signal ties it to that member: they own it, they are its named
Responsibility Holder, or they hold their own Reminder Schedule for it.

This deliberately narrows Phase Seven's Today eligibility, which considered any
visible General Action. Without the narrowing, every household chore would land
in both partners' private shortlists and Today would stop answering what is
relevant to *me*. A household-native Routine with no holder and no subscribers is
the intended calm case: it sits on the shared Household home, where the household
can see it, and nags nobody privately.

A member's **Not today** choice suppresses only their own Today for the rest of
their local day. It never hides, reorders, or defers the record on the Household
home or for another member.

## Eve, Capture, and Search

Explicit household intent may create or change a household-native Action through
the same authenticated product mutation, with the household audience stated back
before the write. Clear save intent with an ambiguous subject asks whether the
record belongs to the caller or to the household rather than inferring from `we`,
the conversation topic, or active membership.

Eve may complete, skip, or edit only on the caller's explicit instruction and
only where the caller is authorized. It never acts on behalf of another member,
never names or changes a Responsibility Holder on its own initiative, and never
creates a Reminder Schedule for anyone but the caller.

Global Recall returns household-visible Actions and Routines through the existing
**Actions and Routines** result family, permission-filtered, carrying scope,
lifecycle, recurrence, and named holder in the typed payload with a canonical
link.

## Departure, removal, and dissolution

**Departure or removal** takes effect immediately:

- All access to household-native Actions and Routines ends.
- The member's own member-owned Actions at `shared` or `household` scope revert
  to `private` and stay with them.
- Their Reminder Schedules for household records are revoked and pending intents
  cancelled, so no alert can arrive about a record they can no longer see.
- Any record naming them as Responsibility Holder has that name cleared, and
  Tendnote chooses no replacement.
- Household-native records remain with the household in full, including
  occurrences and history, and the departed member's historical attribution.
  Nothing is transferred, orphaned, or rewritten.

**Household Dissolution** carries household-native Actions, Routines,
occurrences, and history into the household-native 30-day recovery set
with the rest of the workspace, and immediately cancels every member's Reminder
Schedules and pending intents for them. Recovery restores the authoritative
household state as a whole. After the window, content is permanently deleted and
only the already-approved minimized non-content audit tombstone remains.
Member-owned records shared into the household revert to `private` and survive
with their owners.

## Not a team task manager

Explicitly excluded from Phase Eight, and not deferred pending evidence:

- Subtasks, projects, dependencies, checklists, comments, mentions, or an
  activity feed.
- A stored turn order, automatic rotation, or any Tendnote-initiated change of who
  is looking after a record.
- Workload balancing, fairness scores, streaks, completion counts, leaderboards,
  or any productivity analytics.
- Approval, verification, or rejection of another member's completion.
- Per-member due dates, per-member completion state, or per-member occurrences of
  one shared Routine.
- Priority and effort classification, which remain deferred by the existing
  General Action model.
- A per-member assignment inbox, a "my chores" backlog, or a default filter to the
  current member's records.
- Autonomous completion or agent-initiated reminder enrollment.

## Implementation boundary

This artifact fixes the collaboration contract, not a storage layout. It leaves
the following sharp for implementation-ticket slicing:

- **Workspace ownership needs a representation.** `general_actions.owner_user_id`
  is `NOT NULL` and references a user, so it cannot express a workspace-owned
  record today. The contract that must hold is workspace ownership, symmetric
  member authority, and survival of departure with attribution; the column shape
  is an implementation choice.
- **The reminder owner check must be relaxed precisely.** `saveReminder` today
  rejects any caller who is not the record's owner. It becomes a current
  visibility and authority check, keeping the per-member schedule key and adding
  only the declined-offer state.
- **The lifecycle seam must be tightened, not loosened.** `requireAction`'s
  fallback currently grants every visible member every lifecycle action; it needs
  the per-form authority table above.
- **Occurrence advancement needs a fence.** Shared completion makes the existing
  unfenced roll-forward observable as a double advance.
- **Routine roll-forward drift becomes visible.** Advancement currently computes
  the next due date from the completion moment rather than from the prior due
  date, so a shared Tuesday chore drifts when completed late. This artifact does
  not redecide Phase Five recurrence, but a chore two people watch makes the drift
  conspicuous and it is worth an explicit implementation decision.

## Domain and decision records

Two glossary entries are added to [`CONTEXT.md`](../../CONTEXT.md):
**Household-Native Record** and **Responsibility Holder**.

Two decisions are hard to reverse and earn ADRs:

- [Household-native records are owned by the workspace](../adr/0214-household-native-records-are-owned-by-the-workspace.md)
  — the cross-domain ownership form this domain instantiates first.
- [Household responsibility is a named holder, not an assignment](../adr/0215-household-responsibility-is-a-named-holder-not-an-assignment.md)
  — which narrowly supersedes the Phase Five deferral of responsibility in
  [ADR 0154](../adr/0154-general-actions-preserve-creator-and-actor-provenance.md)
  and fixes the constraints that keep a named holder from becoming task routing.

The per-member Reminder Schedule and holder-offer behavior extend
[ADR 0203](../adr/0203-reminder-schedules-separate-alert-time-from-domain-time.md)
without contradicting it: no member action enrolls another member, so no new
reminder ADR is warranted.
