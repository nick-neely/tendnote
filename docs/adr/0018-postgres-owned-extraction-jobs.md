# Postgres-Owned Extraction Jobs

Phase 1A suggested-memory extraction should be asynchronous and job-backed, with Postgres as the source of truth for job state. Creating a source record should also create an extraction job with fields such as `source_record_id`, `status`, `attempts`, `last_error`, `idempotency_key`, and `run_after`; workers should claim jobs, apply person-resolution and sensitivity rules, create suggested memories idempotently, write audit log entries, and mark jobs completed, failed, or skipped.

Vercel Queues may be used later as the delivery mechanism for production-grade retries, delayed delivery, and observability, but queue messages should carry job ids rather than owning extraction state. This keeps the first implementation inspectable while leaving a clean path to durable queue-triggered processing.
