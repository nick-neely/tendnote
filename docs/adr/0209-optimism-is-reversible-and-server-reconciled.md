# Optimism Is Reversible And Server Reconciled

Tendnote limits true pre-response optimism to deterministic owner actions whose exact next view and authoritative inverse are known. Reversible lifecycle changes—complete/reopen, pause/resume, archive/restore, reversible skip/defer flows, and Today Later/Not today—may project immediately. Suggestion dismissal is the only review exception: it is feedback about a proposal rather than acceptance of proposed domain truth, so the card may leave optimistically with an Authoritative Undo.

Creates, edits, links, visibility changes, reminder schedules, review acceptance or editing, imports, uploads, and external/provider effects are Pending Mutations. Tendnote preserves and acknowledges submitted input immediately but does not present it as settled domain truth or invent identifiers. A truthful pending artifact may show progress, selected import candidates, or an external draft being created; the resulting domain record or provider effect appears only after authoritative confirmation.

Permanent deletion, unique-source deletion, connection revocation, and identity or authority transitions are Locally Blocking Mutations. Their proportional confirmation and affected context remain in place until success. Archive and restore stay separate reversible lifecycle actions. An irreversible operation never offers a cosmetic Undo.

## Authoritative completion

Every mutation re-resolves admission, ownership or visibility, freshness, validation, and current lifecycle on the server. A successful user-originated action returns only after the durable write commits and every affected typed owner, entity, and collection scope is synchronously expired with `updateTag`. It returns the authoritative view plus a revision or mutation marker. The client replaces its projection with that view, refreshes dependent regions, and ignores server renders older than the acknowledged mutation.

Background jobs, webhooks, imports, Eve work, and provider callbacks may use `revalidateTag(tag, "max")` and briefly retain truthful stale content while revalidating. Direct user writes may not. Route invalidation remains a migration safety net until tag-coverage tests prove it redundant.

An Authoritative Undo is an inverse server command, not a client-only cancellation. If requested while the original command is pending, the client records the desired final state and serializes the inverse after the original settles so a late response cannot reapply an apparently undone change.

## Duplicate and concurrent intent

The client permits one in-flight mutation per record and intent while leaving unrelated records usable. Creates, imports, external effects, and destructive commands carry server-enforced idempotency keys. Lifecycle commands are state-aware, so an identical retry returns the current authoritative view without duplicating work. An incompatible stale intent is rejected and reconciled to the latest authoritative view rather than silently winning.

A concurrent refresh cannot resurrect a locally resolved row or overwrite a newer acknowledged edit. Revision-aware reconciliation replaces the current merge-only behavior wherever cached server trees can arrive out of order.

## Failure and interaction continuity

Failure is local to the affected control or region. An optimistic failure restores the exact prior view in its original position and returns focus to the initiating control. A pending form preserves all input and exposes an inline actionable error. A conflict replaces the projection with the latest authoritative view and explains that the record changed elsewhere. Destructive and external failures keep their dialog or context open.

Pending state uses visible text and `aria-busy`, not a spinner alone. When a row leaves successfully, focus moves to the next logical row, then the previous row, then the section heading if the list is empty. Polite live announcements describe completion, rollback, and Undo availability; assertive announcements are reserved for destructive or authority-changing failures.

Tendnote remains online-required. Timeouts and connection loss restore the prior projection or preserve the pending draft, mark the outcome unconfirmed, and offer an explicit retry with the same idempotency key. Mutations are never queued silently or replayed when connectivity returns.
