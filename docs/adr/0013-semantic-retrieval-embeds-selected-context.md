# Semantic Retrieval Embeds Selected Context

Phase 1D pgvector semantic retrieval should come after relational retrieval, context snapshots, and full-text search are working. Embeddings may be generated for approved memories, approved or accepted suggested memories, non-sensitive interaction summaries, and non-sensitive user-created notes by default; other source records such as Gmail summaries, calendar summaries, imported notes, suggested memories, and private household context should be embedded only when source, sensitivity, minimization, scope, and retention rules allow it.

Embeddings are another representation of the underlying content, not harmless metadata. Every embedding row must inherit the same access controls, sensitivity rules, visibility filters, and retention posture as its source item, and raw email bodies, raw message logs, dismissed memories, archived sensitive records, and high-risk sensitive notes should not be embedded by default.
