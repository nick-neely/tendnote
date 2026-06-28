# Persist Generated Briefs

Phase 1 daily and weekly briefs should be stored as one generated brief artifact model with child brief items rather than recomputed from scratch on every render. Daily and weekly variants differ by cadence, window, caps, and ranking depth, not by separate tables or lifecycle rules. Brief generation should be idempotent for `ownerUserId + localDate + cadence`, so scheduled retries or duplicate invocations return the existing brief unless the user explicitly regenerates it. Brief records should store generation metadata such as generated time, generation reason, agenda window, and optional summary provenance for debugging. Brief generation can use the current retrieval stack, including due follow-ups, source records, approved memories, suggested memories, context snapshots, and later full-text or semantic retrieval, but once a brief item is shown it should have stable status, rank, source references, and its own dismissal, snooze, or acted-on lifecycle.

This makes a brief a user-facing artifact that can be reviewed and acted on without flickering, disappearing, or reappearing after the user dismisses it. Brief-item lifecycle changes should not mutate the underlying source record, memory, or follow-up unless the user explicitly takes an action such as accepting a suggested follow-up.

Brief generation and regeneration should consider prior brief-item feedback. Dismissed or currently snoozed items with the same source references, person, and kind should not immediately reappear unless the snooze has expired or the user explicitly asks to ignore prior feedback.

Brief items should snapshot the agenda candidate fields shown to the user, including kind, person, title, reason, due date, source references, trust level, sensitivity, and rank. Source references remain the grounding path, but render-time title, reason, and rank should not be recomputed from the live agenda query.

Scheduled brief generation is proactive context use. Restricted content should be excluded from generated briefs by default, while sensitive content may appear only with source grounding and careful phrasing.

Brief item selection should remain deterministic and source-backed in Phase 1F. An LLM-generated summary line may be stored as nullable presentation text on the brief record, but it must not select items, change ranks, create actions, or become the source of truth for the brief. If summary generation fails, Tendnote should still create the brief with deterministic items and no summary.
