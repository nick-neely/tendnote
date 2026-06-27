# LLM Extraction Runs Per Source Record

Phase 1E.5 LLM suggested-memory extraction should invoke the model once per eligible source record, passing retained content plus the resolved people linked to that record, rather than running one model call per person link. The adapter returns zero or more atomic candidate memories tagged to resolved `personId` values only, which preserves multi-person note context while keeping unresolved mentions out of extracted suggestions and allowing the shared processor to enforce idempotency, policy gates, audit logging, and review lifecycle rules.
