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

A job whose account has reached its background Account Ceiling is deferred, not failed ([ADR 0254](adr/0254-background-and-web-search-ceilings-pause-where-the-spend-happens.md)). The model-call entry point refuses the call, and the processor puts the job back in `pending` with its `run_after` at the start of the Usage Period's reset day and no `last_error`; Context Fact extraction, the one family that dead-letters on attempts, also hands back the attempt its claim counted. The queue message is acknowledged, so nothing redelivers it early; the backfill above picks the job up once it is due. The Spend Breaker defers the same way while it sheds background work ([ADR 0255](adr/0255-the-spend-breaker-sheds-in-stages-past-its-daily-ceiling.md)), with `run_after` at the next UTC midnight, when the breaker's day ends. Reminder pushes have no model call and are never deferred.

More bounded sweeps ride the same cron pass but are not queue outbox deliveries: an account-deletion sweep (`runAccountDeletionSweep`, up to 10 accounts per pass) that resumes self-service and retention-deadline deletions whose Recovery Journal write or disposition failed at request time and logs `account_deletion.intent_stuck` for any intent still incomplete after twenty-four hours, a household purge sweep (`runHouseholdPurgeSweep`, up to 3 households per pass) that erases workspaces whose thirty-day recovery window has closed, and an audit-log retention sweep (`runAuditLogRetentionSweep`, up to 100 entries per pass) that deletes expired audit trail entries. The last two are periodic housekeeping over their own tables, not delivery/processor-job recovery, and neither publishes to a queue. After the database sweeps, the route also deletes Effect Fences (#620) older than the fence retention constant (`sweepEffectFences`, up to 100 a pass) from the Recovery Journal's Blob store; a failure there is logged and retried next pass rather than failing the cron. Last, it runs the retention-deadline sweep (`runAccountRetentionSweep`, up to 25 accounts per pass, #621), which sends the day 0, 60, and 83 deletion notices to Lapsed and Terminated accounts and purges each whose deadline has passed through the account-deletion path.

Before any of that, the same pass runs the Stripe reconciliation job (#608). In hosted mode with Stripe configured, it reads Stripe's paid invoices from the last thirty days and projects each paid first invoice onto Paid Access through the same rule as the webhook receiver, so a dropped or permanently failed delivery is repaired on the next pass. A first invoice whose subscription has since ended admits nobody, so a Lapsed account stays Lapsed. It then re-reads every subscription Stripe reports changed in the same thirty days (the window Stripe keeps events for) and projects it as the webhook does, so a lost period end still makes the account Lapsed and a lost scheduled cancellation still shows its Ending notice (#609). Last, it closes every dunning window that has run its seven days (#610): each subscription recorded Past Due that long is re-read from Stripe and, if its renewal is still unpaid, cancelled there, which stops Stripe's retries and makes the account Lapsed through the same end projection; one that recovered meanwhile is just projected as recovered. Then it replays every refund and dispute Stripe lists from the same thirty days through the webhook's revocation rules (#617): a refund matching a Refund record revokes Paid Access on the subscription that record names, a dispute revokes unless a re-admission grant names it, and a refund matching no record changes nothing and is logged on every pass. A first invoice whose subscription a refund or an unexcepted dispute revoked admits nobody either, though a disputed subscription lives on until its period end. An account already admitted is left alone and gets no second "you're in" email; it never overwrites an operator grant or touches an admission block. It runs first and never throws, so a failing stage later in the pass cannot hold up a paying customer. Each failure is logged as `stripe_reconciliation.failed` (with `stage` of `list`, `project`, `announce`, `events`, `subscription`, `dunning`, `refunds`, `refund`, `disputes`, `dispute`, or `unmatched_refund`, the last carrying the refund id) for the operator alert channel. The next pass retries a failed read (`list`, `events`, `subscription`, `refunds`, `disputes`), grant (`project`), window close (`dunning`), or revocation (`refund`, `dispute`). A failed "you're in" email (`announce`) is not retried, because the account is already admitted; the Effect Fence every delivered Resend email writes (#620) is what keeps a restore from sending it again. Self-hosted deployments skip it.

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
