# Separate Memory And Follow-Up Suggestion Rules

Phase 1 source records may feed both suggested memories and suggested follow-ups, but the processors and policy rules should remain separate. Memory extraction creates durable-context candidates; follow-up suggestion creates possible future actions with timing, usefulness, and annoyance-control concerns.

Both processors can share source records, extraction jobs, audit logging, and retrieval helpers, but they should not become one undifferentiated logic path.
