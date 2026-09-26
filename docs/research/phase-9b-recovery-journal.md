# Recovery Journal mechanics for deletions and admission records

Researched 2026-09-21 UTC from public primary sources for [Research the simplest durable Recovery Journal for deletions and admission records](https://github.com/nick-neely/tendnote/issues/584). Every vendor URL below was accessed 2026-09-21. This resolves the "Recovery Journal mechanics are unresolved" hand-off in [Bounded usage and the author-operated support contract](../phase-9b/bounded-usage-and-support-contract.md). It recommends a store and a write protocol; it does not set the Deletion Record Retention number, which is an owner decision informed by the retention arithmetic below.

## What the journal has to survive

Neon instant restore is a destructive in-place operation on the branch, not a merge. The docs state that "whenever you restore a branch, you are performing a _complete_ overwrite of the database timeline, not a merge or refresh. All Postgres data and schema on your branch...are replaced with the contents from the historical source." The compute is moved to a new point-in-time branch which is renamed to the original branch name, and the pre-restore state is preserved as an automatically created backup branch named `{branch_name}_old_{head_timestamp}`. [Instant restore](https://neon.com/docs/introduction/branch-restore)

Two consequences drive the whole design. First, anything written to the product database after the restore point is gone from the live branch, so a Deletion Record stored as a row is exactly as reversible as the deletion it records. Second, every idempotency and delivery-state column this repo already relies on is inside that same branch: `extraction_jobs.idempotency_key`, `action_extraction_jobs.idempotency_key`, `owner_data_export_jobs.idempotency_key`, `relationship_context_embedding_jobs.idempotency_key`, `background_job_deliveries`, and `reminder_delivery_jobs` (`packages/db/src/schema/app/`). Fencing a completed outbound effect therefore cannot be sourced from the database, because the restore rolls the "already sent" fact back alongside the job row.

The product also has no Deletion Record today. Deletion runs through Better Auth's `deleteUser.beforeDelete` hook in `apps/web/src/lib/auth/server.ts`, which calls `assertHouseholdAccountDeletionAllowed` and then deletes. Nothing is written outside Postgres first.

## Candidate stores

**Vercel Blob.** Generally available, S3-backed, documented at 99.999999999% durability and 99.99% availability. `put()` refuses an existing pathname by default: "By default, Vercel Blob prevents you from accidentally overwriting existing blobs by using the same pathname twice. When you attempt to upload a blob with a pathname that already exists, the operation will throw an error." `ifMatch` gives ETag-based optimistic concurrency on `put()`, `copy()`, and `del()`. `list()` takes a `prefix`, a `cursor`, and a `limit`, and returns blobs in "**lexicographical order** by pathname (not creation date)". Nothing in the docs expires a blob automatically, and there is no TTL or lifecycle feature. The one documented staleness hazard is bounded and applies only to mutation: "When you delete or update (overwrite) a blob, the changes may take up to 60 seconds to propagate through our cache." Private stores are read through your own Function via `get()`, and there is a documented escape from that window: "When a read must reflect the latest write, such as fetching a file right after updating it, pass `useCache: false`... This serves the read directly from origin storage and guarantees the latest content." [Vercel Blob](https://vercel.com/docs/vercel-blob), [Private storage](https://vercel.com/docs/vercel-blob/private-storage)

On cost, `put()`, `copy()`, and `list()` are billed advanced operations while `del()` is free, and the Hobby allowance is only 2,000 advanced operations a month against 4,500 per minute on Pro. [Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing). Repeated `list()` polling, not writing, is the expensive axis of this design.

**Vercel KV.** Verified gone as a first-party product, and the docs say so outright: "Vercel KV is no longer available. If you had an existing Vercel KV store, we automatically moved it to Upstash Redis in December 2024. For new projects, install a Redis integration from the Marketplace." [Vercel Redis](https://vercel.com/docs/redis). The current storage overview lists exactly three options, Blob, Global Config, and Marketplace storage, and the Marketplace page confirms "For KV (key-value stores), you can use Upstash Redis." [Vercel Storage overview](https://vercel.com/docs/storage), [Storage on Vercel Marketplace](https://vercel.com/docs/marketplace-storage). The ticket's premise is correct. Note that the Redis this repo already uses through `ioredis` is a cache and a Better Auth secondary store, and step 6 of the restore procedure already treats it as something to be invalidated, not read.

**Global Config** (Edge Config, renamed). Disqualified by its own documentation, not by inference. Maximum store size is 1 MB on every plan including Enterprise, write propagation is "Up to 10 seconds globally", and the page says directly: "You should avoid using Global Configs for frequently updated data or data that needs to be accessed immediately after updating." [Global Config limits](https://vercel.com/docs/global-config/global-config-limits). A 1 MB ceiling cannot hold a growing append-only record set, and a 10-second propagation window cannot support write-before-delete ordering.

**A second Neon branch.** Disqualified, and for a sharper reason than it first appears. Branch restore is per branch, so restoring the product branch would not by itself rewrite a sibling journal branch. But branches are copy-on-write clones sharing the parent's storage lineage, the history window is a single project-level setting ("Only root branches support point-in-time restore; a single history window applies per project"), and project deletion takes everything with it: "Deleting a project also deletes any computes, branches, databases, and roles that belong to the project", recoverable for seven days and then permanent. [History window](https://neon.com/docs/postgres/backup-restore/history-window), [Branching](https://neon.com/docs/introduction/branching), [Manage projects](https://neon.com/docs/manage/projects). A branch reduces the point-in-time-restore risk without escaping the project-level blast radius.

A second Neon *project* is a genuinely separate timeline and would work; the Free plan allows 100 projects with 0.5 GB storage and 100 CU-hours each [Neon plans](https://neon.com/docs/introduction/plans). It is the credible runner-up. It is rejected on simplicity rather than correctness: it is a second Postgres to migrate, monitor, and keep schema-compatible, and **Neon publishes no explicit cross-project fault-isolation guarantee, so its isolation is inference rather than a documented promise.** A schema-bearing SQL store is also precisely the thing that drifts into becoming the second authoritative event store the owner rejected.

**Stripe metadata.** Disqualified as the journal, useful as corroboration. Metadata allows "up to 50 keys, with key names up to 40 characters long and values up to 500 characters long", and the API reference instructs: "Don't store any sensitive information (bank account numbers, card details, and so on) as metadata." [Stripe metadata](https://docs.stripe.com/api/metadata). Fifty keys cannot hold a growing record set, metadata attaches only to billing objects so it has no natural home for a Legal Hold or a Deletion Record, and step 4 of the restore procedure already retrieves live Stripe subscriptions, refunds, and disputes from the API, which is the better use of Stripe.

Stripe also cannot fence anything, which is worth stating because it is a tempting shortcut. Idempotency keys are pruned quickly: "You can remove keys from the system automatically after they're at least 24 hours old. We generate a new request if a key is reused after the original is pruned." [Idempotent requests](https://docs.stripe.com/api/idempotent_requests). Twenty-four hours is one to two orders of magnitude shorter than the restore exposure computed below. The Search API is likewise unsuitable: "Don't use search for read-after-write flows... because the data won't be immediately available to search." [Stripe search](https://docs.stripe.com/search). Stripe's retention of objects and metadata is **not documented on these pages**, so no retention argument should rest on it.

**Vercel Queues.** Disqualified as the store of record on retention alone. Messages are durably replicated to three availability zones before publish returns and delivery is at-least-once, but "Retention is configurable per-message from 60 seconds to 7 days, defaulting to 24 hours", and messages "are permanently deleted when their retention period (TTL) expires, regardless of processing state". [Queues concepts](https://vercel.com/docs/queues/concepts). Seven days is shorter than any plausible Deletion Record Retention.

## Recommendation: one private Vercel Blob store, one immutable blob per record

Create a single private Blob store, connected to the product's Vercel project, holding one JSON blob per record. The pathname is the record identity:

```
journal/deletion/2026-09-21T14:03:22.145Z-<accountId>.json
journal/suspension/<iso>-<accountId>-<actionId>.json
journal/termination/<iso>-<accountId>-<actionId>.json
journal/legal-hold/<iso>-<accountId>-<actionId>.json
journal/grant/<iso>-<accountId>-<actionId>.json
journal/_cutover/<iso>.json
fence/email/<iso>-<effectKey>.json
```

Five properties fall out of the vendor contract rather than out of application code, which is why this is the simplest option that actually works.

**Idempotent create is the default.** `put()` without `allowOverwrite` throws on an existing pathname, so re-applying a record is a no-op at the API boundary. No compare-and-swap, no read-modify-write, no `ifMatch` bookkeeping. Re-application after restore is idempotent for the same reason: the recovery pass reads records and applies effects keyed by the same identifiers, and writing is never part of the replay.

**Chronological order is lexicographic order.** `list()` orders by pathname, and a fixed-width ISO 8601 UTC timestamp sorts lexicographically in time order. The Vercel docs recommend exactly this ("Sort by creation date: Include timestamps in pathnames"). Drain becomes `list({ prefix: 'journal/deletion/', cursor })` paged to exhaustion.

**Retention is explicit.** Nothing expires on its own, so Deletion Record Retention is enforced by a sweep that calls `del()`, which is free and does not throw on a missing key. That also means an accidental retention bug leaves records present rather than absent, which is the correct failure direction for a deletion journal.

**It is not an event store.** Product code never reads the journal. Writes are fire-and-confirm during normal operation; the only reader is the recovery cron and the restore runbook. Admission decisions continue to be made from the database, which stays the operational authority, per [ADR 0248](../adr/0248-admission-exceptions-live-inside-their-condition.md).

**Content-free.** A Deletion Record is an account id and a time. An admission record is an account id, an action kind, a reason code, an actor, an expiry, and a time. No note bodies, no names, no email addresses. This matters for the retention promise below.

### Write-before-delete ordering and what happens when the journal write fails

The ordering is: durable local intent, then journal, then destructive work. Concretely, for deletion:

1. In one product-database transaction, insert a `deletion_intent` row (`account_id`, `requested_at`, `state = 'pending'`) and commit. The customer's screen returns on this commit.
2. `put()` the Deletion Record blob. Await it.
3. Set the intent to `journaled`.
4. Run the existing `assertHouseholdAccountDeletionAllowed` disposition and delete the rows.
5. Set the intent to `completed`, or delete the intent row.

If step 2 fails, the request still succeeded from the customer's point of view and the intent row is the durable record of the request. The existing `/api/cron/background-jobs` pass, which already runs every ten minutes (`apps/web/vercel.json`) and already drains `HOUSEHOLD_PURGE_LIMIT` irreversible purges per pass, picks up pending intents and retries from step 2. That answers the ticket's "where a deletion request is recorded if the journal write fails" without adding a second scheduler.

The ordering is safe under restore precisely because the intent row is inside the database. If a restore rolls the intent back, it rolls the deletion back too, because rows are never deleted before the journal write is confirmed. The only reachable states are: journaled and deleted (the record re-applies the deletion after a restore), journaled and not yet deleted (the cron finishes it), or neither (the account is simply still present and the customer's request is unfulfilled and visible as a pending intent). There is no state where rows are gone and no Deletion Record exists.

The customer-facing wording must follow the mechanism. The privacy artifact currently promises deletion is "self-service and immediate" ([hosted privacy obligations](../phase-9b/hosted-privacy-and-customer-lifecycle-obligations.md)). That remains true for the live database in the normal path, but the honest formulation is that the request is accepted immediately and completes once journaled. **This is an owner decision, not a research conclusion.**

Suspension, termination, Legal Hold, and grant records use the same three-step pattern, driven from the Operator Action runbooks rather than from a customer request: write the authoritative row, `put()` the mirror blob, mark the row `journaled`. The same cron pass retries any row left unjournaled. The database does not stop being the authority, because nothing reads the mirror except recovery.

### Draining to a known point during cutover

The restore procedure already stops production writes at step 2. After that stop, wait a settle interval, then `put()` a cutover marker at `journal/_cutover/<iso>.json`, then drain every `journal/<kind>/` prefix to exhaustion and apply every record whose timestamp precedes the marker.

The settle interval must exceed the longest possible in-flight write. In this repo that is the route segment `maxDuration = 300` on the background-jobs cron (`apps/web/src/app/api/cron/background-jobs/route.ts`); Vercel also documents that "Creating a new deployment will not interrupt your running cron jobs; they will continue until they finish" ([Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)). Ten minutes is a defensible interval and should be drilled, not assumed.

**Inference, not a documented guarantee:** Vercel's docs state the 60-second propagation caveat only for delete and overwrite, and say nothing about `list()` consistency for newly created pathnames. Treat immediate visibility of a brand-new blob in `list()` as unverified. The design tolerates being wrong about it: re-application is idempotent, so a record that surfaces after the drain is simply applied by the next cron pass rather than lost or double-applied. Read record bodies with `get({ useCache: false })` during recovery so the CDN cannot serve a stale body.

### Fencing completed outbound effects

Fence narrowly and deliberately, because a fence blob per effect is a paid write on every send.

Write a fence blob at `fence/<kind>/<iso>-<effectKey>.json` **after** an effect that leaves the system succeeds, for exactly two kinds: Resend email sends and owner data export deliveries. `effectKey` is the deterministic business key already present in the schema, for example `owner_data_export_jobs.idempotency_key`. After a restore, the recovery pass loads the fence prefix for the window between the restore point and the cutover and marks the matching restored jobs complete before outbound is re-enabled.

Do not fence push reminders. Reminders are the one class the support contract says is "never deliberately shed", the volume is the highest of any effect, and a duplicate push is a far smaller harm than a suppressed one. Accepting a possible duplicate reminder across a restore is the right trade and should be written down as such rather than discovered during a drill.

Fence retention is short and separate from Deletion Record Retention: a fence is only ever consulted for effects inside the restore window, so the history window plus a margin (fourteen days against a seven-day window) is sufficient. That also keeps `list()` volume during recovery small.

Do not expect Stripe to help here. Its idempotency keys are pruned after roughly 24 hours, which is far shorter than any restore exposure, so billing-side re-execution after a restore has to be prevented by reconciling against live Stripe objects as [the subscription lifecycle research](phase-9b-stripe-subscription-lifecycle.md) already prescribes, not by relying on a key Stripe has forgotten. Vercel Queues does deduplicate republishes, but only "for the entire lifetime of the original message (up to its TTL)", which is at most seven days ([Queues concepts](https://vercel.com/docs/queues/concepts)).

## Deletion Record Retention: the arithmetic

The parameter must cover the longest-lived artifact that could resurrect an account, which is the maximum of three Neon retention surfaces, not just the history window.

| Surface | Documented behaviour |
| --- | --- |
| History window | Free: 6 hours default and maximum, "capped at 1 GB of history". Launch: 1 day default, 7 days maximum. Scale: 1 day default, 30 days maximum. Retained WAL bills as history storage at $0.20/GB-month. [History window](https://neon.com/docs/postgres/backup-restore/history-window) |
| Scheduled snapshots | Retention set in seconds "from 3600 (1 hour) to 3024000 (35 days)". [Neon CLI snapshots](https://neon.com/docs/cli/snapshots) |
| Manual snapshots | "Omit `--expires-at` to keep the snapshot until you delete it; a manual snapshot's expiration has no maximum, unlike the 35-day cap on scheduled snapshots." Free projects allow 1 manual snapshot, paid projects 100. [Neon CLI snapshots](https://neon.com/docs/cli/snapshots) |
| Restore backup branch | Created automatically as `{branch_name}_old_{head_timestamp}`. The docs specify no expiry. [Instant restore](https://neon.com/docs/introduction/branch-restore) |

Two of these four are unbounded by default, so the retention number is only computable if operational rules bound them. The rules should be: no manual snapshot without an explicit `--expires-at`, scheduled snapshot retention capped at Neon's own 35-day maximum, and restore backup branches deleted once a restore is verified and recorded. With those rules the longest surface is 35 days, and **90 days is a defensible Deletion Record Retention**: 35 days of snapshot plus a 55-day operational margin for a one-operator service that may not notice a stray snapshot for weeks. It coincides numerically with the ninety-day Lapsed constant but must be its own named constant with its own derivation, exactly as the support artifact requires.

Two facts worth surfacing to the owner. The seven-day published recovery window is the **maximum** on Neon's Launch plan, so it leaves no headroom; Scale's 30-day maximum is the only plan with room above it. And the production project's currently configured six hours is precisely the Free-plan cap, which is consistent with the reading recorded on 2026-09-16 in the support artifact. **This is documentation, not an inspection of the live project; nothing was read from or written to any Neon project during this research.**

One surface is deliberately excluded. Neon's backup guidance also covers `pg_dump` exports on a recurring schedule to external object storage ("For business continuity, disaster recovery, or compliance, you can use standard Postgres tools to back up and restore your database") [Neon backups](https://neon.com/docs/manage/backups). Tendnote runs no such exports today. If it ever starts, their retention joins this maximum and the Deletion Record Retention must be recomputed, because an export is a backup that can resurrect an account exactly as a snapshot can.

Retaining a content-free Deletion Record for ninety days does not contradict the published "gone from backups within one day" promise, because the record holds an account id and a time and no content. The open conflict between the one-day backup promise and the seven-day recovery window is a separate item, already tracked as [issue 585](https://github.com/nick-neely/tendnote/issues/585).

## Scheduling constraints the recovery cron inherits

Vercel documents cron delivery honestly and the recovery pass must assume all of it: "Cron job delivery is best effort", "Vercel will not retry an invocation if a cron job fails", "Cron delivery can also occasionally invoke the same scheduled run more than once", and therefore "cron jobs should be resilient to both missed runs and duplicate runs". Vercel recommends a lock against overlap and idempotent reconciliation against duplication. Hobby accounts are additionally limited to once per day and to an arbitrary minute within the specified hour; other plans are invoked within the specified minute. [Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

The existing every-ten-minutes schedule therefore already requires a Pro plan, and the journal retry path should be a query over pending intents rather than anything that assumes a run happened.

## Limits and later verification

No Vercel Blob store, Global Config, Neon project, Stripe object, or production system was created, inspected, or changed. Everything above is public documentation plus this repository's source. Blob `list()` read-after-create consistency is the one load-bearing property the docs do not state; the design is built to tolerate its absence, but the drill should measure it.

Later verification should cover: a journal write failing mid-deletion and the cron completing it; a restore across a deletion, confirming the account does not return; a restore across a completed email send, confirming it is not re-sent; a drain with a write in flight at cutover; and a retention sweep that deletes an expired Deletion Record while a snapshot within the window still exists. These belong in the restore drill in [issue 582](https://github.com/nick-neely/tendnote/issues/582), not in a separate exercise.

## Still owner decisions

The Deletion Record Retention value; whether the deletion promise is reworded from "immediate" to "accepted immediately, completed once journaled"; whether push reminders are left unfenced; the Neon plan and configured history window; and whether the operational rules bounding snapshots and backup branches become a runbook step or a scripted check.
