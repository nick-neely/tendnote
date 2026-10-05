# Private files and assistant attachments

## Requested behavior

Replace Postgres file-byte storage with private Vercel Blob. Picking an image or
PDF in the assistant should attach it to the next message so the assistant can
read it. Saving that attachment to an Asset is a separate, optional action.
Preserve Asset access rules, existing files, deletion, and account export.

The user approved chat-first behavior, tests at the public upload/read/delete,
assistant submission, and Asset lifecycle boundaries, and review against
91ab2f1945233dd6c8caf8bba7e7ddaefc0fe18a.

## Behavior and boundaries

- One image or PDF per message, up to 10 MiB. Pick, paste, and drop use the same
  flow. Upload starts on Send or explicit Asset save, not on selection.
- Chat attachments are private to the uploading account. A durable file reference
  stays with queued messages and conversation replay. Reading does not create an
  Asset or confirm extracted facts.
- Save to an Asset opens the existing destination, details, and audience flow.
  It is available before sending and beside an attachment in the transcript.
  An Asset owns a separate copy, so its visibility and deletion lifecycle do not
  depend on the original conversation attachment.
- The assistant's `read_attachment` tool is disclosed by Recall in web chat.
  It reads an authorized private file and asks the existing pinned hosted model
  a bounded question. Only the generated reading enters tool history; file bytes
  and Blob credentials do not. Attachment contents activate conversation taint,
  just as untrusted web content does. Inferred facts still require review.
- JPEG, PNG, WebP and PDF can be read. HEIC/HEIF can be saved; the reader currently
  requests a compatible copy. There is no arbitrary URL fetch, document inbox,
  bulk import, autonomous attachment ingestion, or change to external-send rules.
- Completed chat uploads remain until explicitly removed or the account is
  deleted. Abandoned, unverified reservations expire and are swept after a day.

## Storage and rollout

Postgres retains metadata and authorization. Browser uploads go directly to a
private Blob store with short-lived tokens for one server-selected path and a
bounded size/type. Completion downloads and checks actual size and magic bytes
before enabling reads. File reads are authenticated, private, and uncached.

Connect Web and Agent to the same private store using Vercel OIDC and
`BLOB_STORE_ID`. Hosted Eve runs inside the Web project through `withEve`, so
both services inherit that project's store connection. A separate Eve project
needs its own OIDC connection to the same store for each environment.
The Recovery Journal (ADR 0250) shares this store: Deletion Records live under
`journal/` and Effect Fences under `fence/`, which file deletion never touches,
so the same OIDC connection also lets account deletion complete. A restore's
cutover markers live under `journal/_cutover/` ([restore runbook](../operations/restore.md)).
Credentials stay server-side. Production has its own store; development and
preview share a separate store. Do not set `BLOB_READ_WRITE_TOKEN`. Locally,
use `vercel env pull` from the linked Web project and re-pull when the
short-lived `VERCEL_OIDC_TOKEN` expires. See the
[restore preconditions](../operations/restore.md#preconditions) for operator access.

1. Create/connect a private Blob store for each deployment environment.
2. Apply the additive database migration before deploying the new readers/writers.
3. Deploy with Blob credentials in both services. All new Asset file writes use Blob.
4. Run `pnpm --filter @tendnote/db db:files:migrate` against the intended database
   with its Blob credentials loaded. Each batch copies up to 100 legacy files,
   verifies SHA-256, and clears Postgres bytes only after verification. Repeat
   until the batch reports zero. Do not run against production without approval.
5. Verify previews, downloads, account export, and recovery cron. The nullable
   legacy byte column remains solely for safe migration fallback, not new writes.

Database deletion triggers write Blob paths to an outbox, including cascades from
Asset deletion, household purge, and account deletion. The existing authenticated
recovery cron retries deletion. A one-hour grace prevents compensation records
from racing active writes; metadata deletion revokes application access immediately.
Failed writes retain compensation records so crashes do not create permanent orphans.
Account exports include owned chat uploads and resolve Asset file bytes from Blob.

## Sources

- [Vercel Blob client uploads](https://vercel.com/docs/vercel-blob/client-upload)
- [Vercel private Blob storage](https://vercel.com/docs/vercel-blob/private-storage)
- Version-matched Eve docs: `apps/agent/node_modules/eve/docs/tools/overview.mdx`
  and `guides/client/messages.mdx`.

## Verification and review

The development browser uploaded the repository icon and the assistant described
its actual colors and shape. A labeled synthetic PDF returned its exact warranty
expiry (`2031-04-17`) and support code (`TN-8426`) without saving facts. The optional
Asset flow created a synthetic Asset; direct storage verification confirmed a
matching SHA-256, a null Postgres byte column, and a deletion outbox entry after
cascade removal. The synthetic Asset was then removed. A separate legacy-byte
fixture migrated with the same checksum and was removed afterward; development
has no remaining legacy file bytes.

Desktop (1440 by 900) and mobile (390 by 844) attachment controls were inspected.
The scoped Impeccable detector returned no findings and the independent finish
review returned **ship**. Next.js reported no configuration or session errors.
The browser contract lane passed 52 tests; the Instant lane passed all 27 checks.

### Standards

No remaining required findings. The review identified a pending-send selection
race and temporary-upload retention after failed Asset saves. Both were fixed,
covered by regression tests, and confirmed by the reviewer. The final storage
and composer extractions were also reviewed. Small compensation duplication in
the one-off migration was accepted as appropriate to its different lifecycle.

### Spec

No remaining findings. The independent review confirmed chat-first behavior,
optional Asset saving, private access, migration fallback, deletion, and account
export. Its two lifecycle findings matched the Standards findings and were
confirmed resolved. Production rollout remains a separate operational step.

Final local gates passed: `pnpm verify`, `pnpm db:check`, `pnpm test:browser`,
`pnpm test:instant`, `pnpm coverage:ci`, and
`FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci` (no findings).
