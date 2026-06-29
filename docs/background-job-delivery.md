# Background Job Delivery

Tendnote uses a backend-only background job delivery foundation for lightweight asynchronous processors. Postgres remains the source of truth for product job state; Vercel Queues is the default production transport that wakes processor-specific consumers.

The delivery ledger is `background_job_deliveries`. Each row records a queue publication intent with `id`, `owner_user_id`, `job_kind`, `job_id`, `topic`, `status`, `attempts`, `last_error`, `next_attempt_at`, `created_at`, `updated_at`, and `published_at`. `job_kind` currently supports `extraction` and `embedding`. Delivery status is transport-only:

- `pending`: the delivery intent exists and has not been accepted by the queue.
- `published`: Vercel Queue accepted the send call. This does not mean the job was consumed or processed.
- `publish_failed`: the durable product record and processor job exist, but queue publication failed and can be retried.
- `abandoned`: recovery found the underlying processor job terminal or no longer valid.

Topic routing goes through the typed topic map in `@tendnote/db/queries/background-job-deliveries`; the concrete topic string is still stored on each delivery row for inspection. Current topics are `extraction` and `embedding`. Queue payloads carry `deliveryId`, `jobKind`, and `jobId` as pointers. Consumers reload the delivery row and processor job from Postgres, validate payload fields, and then process only the delivered job id through the shared extraction or embedding processor.

Local development can keep work inline through the existing processor runtime modes. Ordinary verification uses fake queue adapters and fake queue messages, so `pnpm verify` does not require Vercel Queue access or live provider credentials.

## Runtime Configuration

Production and preview deployments need the Vercel Queue integration available to the app runtime, the `apps/web/vercel.json` queue triggers deployed, and normal app/database environment variables configured. The queue callbacks are:

- `/api/queue/extraction` for the `extraction` topic.
- `/api/queue/embedding` for the `embedding` topic.

The recovery cron is `/api/cron/background-jobs` and is scheduled every ten minutes in `apps/web/vercel.json`. Set `CRON_SECRET` in production and preview so manual cron calls require `Authorization: Bearer <CRON_SECRET>`.

Local development does not need Vercel Queue. Use normal local app variables and let deterministic adapters, inline processing, or fake queue tests cover the path. Optional live queue smoke tests use separate explicit variables:

- `TENDNOTE_VERCEL_QUEUE_SMOKE=1`
- `TENDNOTE_VERCEL_QUEUE_SMOKE_TOKEN`
- `TENDNOTE_VERCEL_QUEUE_SMOKE_REGION`, for example `iad1`
- `TENDNOTE_VERCEL_QUEUE_SMOKE_TOPIC`, a dedicated smoke topic that does not overlap production extraction or embedding topics

Run the smoke with `pnpm --filter @tendnote/web test -- vercel-queue.smoke`. It is skipped by default in local and CI verification. When enabled, it publishes and receives a synthetic message through Vercel Queue only; it does not assert suggested-memory extraction, embedding outcomes, or live model/provider behavior.

## Recovery And Inspection

The recovery dispatcher runs bounded work. It republishes due `pending` or `publish_failed` delivery intents, abandons obsolete delivery intents, and runs capped extraction and embedding backfill through the same shared processors used by queue consumers.

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
