# Postgres-Owned Extraction Jobs

Phase 1A suggested-memory extraction should be asynchronous and job-backed, with Postgres as the source of truth for job state. Creating a source record should also create an extraction job with fields such as `source_record_id`, `status`, `attempts`, `last_error`, `idempotency_key`, and `run_after`; workers should claim jobs, apply person-resolution and sensitivity rules, create suggested memories idempotently, write audit log entries, and mark jobs completed, failed, or skipped.

Vercel Queues should be the default production delivery mechanism for extraction jobs once queue delivery is wired. Queue messages carry extraction job ids and call the shared processor; they do not own extraction state. Cron, local inline processing, and manual/admin runners are recovery, backfill, and development paths for pending Postgres jobs when queue delivery is unavailable or intentionally bypassed.

Source-record capture must not fail just because queue publishing fails. Capture should save the source record and enqueue the Postgres extraction job first; queue publishing is best-effort delivery. If publishing fails, the job remains `pending`, the failure is logged or audited for operators, and recovery/backfill paths can process or republish the pending job later.
