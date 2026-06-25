# Shared Extraction Processing

Phase 1A extraction processing should live in shared package functions rather than inside a web route handler or Eve-only tool. Functions such as `claimExtractionJob`, `processExtractionJob`, and `extractSuggestedMemories` should own the job-claiming, source-record loading, policy checks, idempotent suggested-memory creation, and audit logging behavior.

The web app, Eve agent, Vercel Queues, Cron, or Workflows should act as triggers for those shared functions. This keeps extraction behavior consistent while allowing the delivery mechanism to change later.
