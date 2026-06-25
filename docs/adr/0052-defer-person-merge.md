# Defer Person Merge

Phase 1A should not implement a full merge-people flow. Person merge touches profile data, contact methods, source record links, memories, follow-ups, drafts, audit logs, and future embeddings, so it should wait until imports or real usage make duplicate records common enough to justify the complexity.

Phase 1A should instead rely on disambiguation before linking, duplicate display-name support, editable profile details, archiving mistaken duplicate people, and small manual relinking repairs where needed.
