# Shared Job Processing

Phase 1A extraction processing should live in shared package functions rather than inside a web route handler or Eve-only tool. Functions such as `claimExtractionJob`, `processExtractionJob`, and `extractSuggestedMemories` should own the job-claiming, source-record loading, policy checks, idempotent suggested-memory creation, and audit logging behavior.

The same pattern applies to other lightweight async Tendnote processors that already own state in Postgres, including semantic embedding jobs. The web app, Eve agent, Vercel Queues, Cron, or Workflows should act as triggers for shared functions rather than owning product behavior.

Production delivery for these shared processors uses Vercel Queues plus an outbox-style delivery intent as described in ADR 0068. Postgres remains the source of truth for product job state; queue delivery only wakes the matching shared processor.
