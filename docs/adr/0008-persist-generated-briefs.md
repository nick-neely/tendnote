# Persist Generated Briefs

Phase 1 daily and weekly briefs should be stored as generated records with child brief items rather than recomputed from scratch on every render. Brief generation can use the current retrieval stack, including due follow-ups, source records, approved memories, suggested memories, context snapshots, and later full-text or semantic retrieval, but once a brief item is shown it should have stable status, rank, source references, and dismissal or snooze behavior.

This makes a brief a user-facing artifact that can be reviewed and acted on without flickering, disappearing, or reappearing after the user dismisses it.
