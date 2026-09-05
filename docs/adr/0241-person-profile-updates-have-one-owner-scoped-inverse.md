# Person profile updates have one owner-scoped inverse

## Decision

A changed Person profile has one durable inverse, shared by Eve's confirmation
card and the owner-only Last profile update section on the person page. This is
recovery for the latest edit, not a version-history feature. The web profile
editor remains outside #557.

The shared `updatePerson` boundary compares validated fields, locks the Person,
and stores the actual prior/next values atomically with the edit. No-op patches
leave the available inverse intact. Each edit has a new opaque update identity
and a strictly increasing `updatedAt` revision, even within one millisecond. All
profile writes use this boundary. Undo locks the same Person and checks owner,
update identity, and revision before restoring the changed fields together. A
newer edit supersedes the old inverse even if the values cycle back to the same
content. Neither the model nor the browser supplies authoritative prior values.

One row per Person bounds retention. Undo consumes the inverse and clears its
before/after values, retaining only a receipt for idempotent retries until the
next edit. Person deletion cascades to that row. Undo cannot recreate a Person,
expose an older inverse, or provide redo. Household-visible Person References
are a different domain and gain no reversal or sharing authority here. Contact
import transactions gain no transactional undo; any profile edit they make uses
the same safe Person mutation boundary.

Both surfaces show actual field changes, including clears as Not set and birthday
years only when known. The direct Undo button invokes an authenticated
`runOwnerAction` mutation independently of Eve's turn. Reload and window focus
reconcile the receipt's current availability; the mutation remains authoritative
when another edit races a read. Pending, applied, already-undone, superseded,
unavailable, and retry states never claim restoration without a server result.
An old status read cannot replace the result of a later click.

## Approval consequences

Under #549's Approval Mode decision, `update_person` now has a reversal path and
qualifies as a Reversible Private Write. The existing policy still checks the
interactive owner, describer, mode, and conversation taint. Its classification
test names `undo_person_update` as the inverse. The conversational Undo tool
itself remains always-ask: consuming the inverse has no redo path. A direct
owner click is already explicit authorization and does not send a second request
through Eve.

## Verification

The shared mutation tests cover exact restoration, clears, no-ops, supersession,
idempotency, and owner/deletion boundaries. The Postgres live check additionally
proves row-lock serialization, competing updates/Undo, and transactional rollback.
UI tests cover direct action, readable values, pending and retry states, revisited
cards, and mobile keyboard operation.

References: #557, #549, ADR 0001, ADR 0209, ADR 0237, ADR 0240.
