# Background Job Delivery

Tendnote uses a backend-only background job delivery foundation for lightweight asynchronous processors. Postgres remains the source of truth for product job state; Vercel Queues is the default production transport that wakes processor-specific consumers.

The delivery ledger is `background_job_deliveries`. Each row records a queue publication intent with `id`, `owner_user_id`, `job_kind`, `job_id`, `topic`, `status`, `attempts`, `last_error`, `next_attempt_at`, `created_at`, `updated_at`, and `published_at`. `job_kind` supports five values: `extraction`, `embedding`, `action_extraction`, `context_fact_extraction`, and `reminder_push`. Delivery status is transport-only:

- `pending`: the delivery intent exists and has not been accepted by the queue.
- `published`: Vercel Queue accepted the send call. This does not mean the job was consumed or processed.
- `publish_failed`: the durable product record and processor job exist, but queue publication failed and can be retried.
- `abandoned`: recovery found the underlying processor job terminal or no longer valid.

For `extraction`, `embedding`, `action_extraction`, and `context_fact_extraction`, recovery treats the underlying processor job's status as the authority on whether a delivery is still worth republishing. `reminder_push` has no processor job in that sense: recovery always treats its deliveries as active and defers to the reminder policy processor, which independently suppresses stale, revoked, completed, or otherwise ineligible work before it ever contacts Web Push.

Topic routing goes through the typed topic map in `@tendnote/db/queries/background-job-deliveries`; the concrete topic string is still stored on each delivery row for inspection. There are three topics: `tendnote-extraction-v1`, shared by `extraction`, `action_extraction`, and `context_fact_extraction` (the consumer route dispatches by the payload's `jobKind`, so one route and one Vercel queue cover all three); `tendnote-embedding-v1`; and `tendnote-reminder-push-v1`. Queue payloads carry `deliveryId`, `jobKind`, and `jobId` as pointers. Consumers reload the delivery row and processor job from Postgres, validate payload fields, and then process only the delivered job id through the shared processor for that job kind.

Local development can keep work inline through the existing processor runtime modes. Ordinary verification uses fake queue adapters and fake queue messages, so `pnpm verify` does not require Vercel Queue access or live provider credentials.

## Runtime Configuration

Production and preview deployments need the Vercel Queue integration available to the app runtime, the `apps/web/vercel.json` queue triggers deployed, and normal app/database environment variables configured. The Vercel project root must be `apps/web` so Vercel reads that config file; if the project root is the repository root, copy or move the deployment config to the root-level `vercel.json` shape instead.

Queue trigger objects in `vercel.json` intentionally include only Vercel-supported properties such as `type` and `topic`. Tendnote's internal `consumerGroup` names live in `apps/web/src/lib/background-jobs/queue-runtime.ts` for logging and future rate-control metadata; they are not valid `vercel.json` fields.

The queue callbacks are:

- `/api/queue/extraction` for the `tendnote-extraction-v1` topic (`extraction`, `action_extraction`, and `context_fact_extraction`).
- `/api/queue/embedding` for the `tendnote-embedding-v1` topic.
- `/api/queue/reminder` for the `tendnote-reminder-push-v1` topic.

The recovery cron is `/api/cron/background-jobs` and is scheduled every ten minutes in `apps/web/vercel.json`. Set `CRON_SECRET` in production and preview so manual cron calls require `Authorization: Bearer <CRON_SECRET>`.

Local development does not need Vercel Queue. Use normal local app variables and let deterministic adapters, inline processing, or fake queue tests cover the path. Optional live queue smoke tests use separate explicit variables:

- `TENDNOTE_VERCEL_QUEUE_SMOKE=1`
- `TENDNOTE_VERCEL_QUEUE_SMOKE_TOKEN`
- `TENDNOTE_VERCEL_QUEUE_SMOKE_REGION`, for example `iad1`
- `TENDNOTE_VERCEL_QUEUE_SMOKE_TOPIC`, a dedicated smoke topic that does not overlap production extraction or embedding topics

Run the smoke with `pnpm --filter @tendnote/web test -- vercel-queue.smoke`. It is skipped by default in local and CI verification. When enabled, it publishes and receives a synthetic message through Vercel Queue only; it does not assert suggested-memory extraction, embedding outcomes, or live model/provider behavior.

## Recovery And Inspection

The recovery dispatcher runs bounded work on the same ten-minute cron. It republishes due `pending` or `publish_failed` delivery intents (up to 25 per pass), abandons obsolete delivery intents, and backfills up to 5 jobs per pass each for `extraction`, `embedding`, `action_extraction`, and `context_fact_extraction` through the same shared processors used by queue consumers.

Two more bounded sweeps ride the same cron pass but are not queue outbox deliveries: a household purge sweep (`runHouseholdPurgeSweep`, up to 3 households per pass) that erases workspaces whose thirty-day recovery window has closed, and an audit-log retention sweep (`runAuditLogRetentionSweep`, up to 100 entries per pass) that deletes expired audit trail entries. Both are periodic housekeeping over their own tables, not delivery/processor-job recovery, and neither publishes to a queue.

Backend-only inspection examples:

```sh
pnpm db:studio
```

Use Drizzle Studio to inspect `background_job_deliveries` by `status` for `pending`, `publish_failed`, or `abandoned` rows.

```sql
select id, owner_user_id, job_kind, job_id, topic, status, attempts, last_error, next_attempt_at, published_at
from background_job_deliveries
where status in ('pending', 'publish_failed', 'abandoned')
order by next_attempt_at asc, created_at asc
limit 50;
```

Manual cron recovery can be invoked against a running deployment or local dev server:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/background-jobs"
```

This PRD adds no user-facing queue UI, queue dashboard, new review surface, or Eve mode. Delivery visibility stays in schema state, structured logs, deterministic tests, optional live smoke tests, and targeted backend inspection or recovery commands.
