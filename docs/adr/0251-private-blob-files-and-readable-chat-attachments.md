# ADR 0251: Private Blob files and readable chat attachments

Status: Accepted by the owner in the October 1, 2026 implementation request.

Supersedes the storage and no-file-reading restrictions in ADR 0185 and the
Phase 6 upload foundation. Other Asset review and visibility rules remain.

## Decision

Store new uploaded file bytes in private Vercel Blob. Keep authorization and
metadata in Postgres. Chat attachments enter the next message by default, and
saving to an Asset is explicit and optional. The existing Asset capture flow
continues to own destination and audience selection.

Give the assistant one owner-scoped attachment reader, available in web chat.
Asset evidence uses the existing visibility proof. The reader uses the pinned
hosted model, returns bounded grounded text, and taints the conversation because
file content is untrusted. It cannot create facts or mutate records.

Use direct browser uploads, server-side byte validation, authenticated downloads,
a durable deletion outbox covering database cascades, account export, and a
checksum-verified migration with legacy read fallback. Never publish private
files or hand Blob credentials to the model or browser.

## Consequences

Blob writes and database commits are not atomic. Pre-recorded compensation and
retryable cleanup replace the old bytea transaction/cascade behavior. Asset copies
have independent lifecycles from chat uploads. A model reading can be wrong, so
extracted facts remain proposals subject to the existing review rules.

See [the feature and rollout contract](../features/blob-assistant-attachments.md).
