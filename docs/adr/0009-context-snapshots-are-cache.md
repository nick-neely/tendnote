# Context Snapshots Are Cache

Phase 1B `person_context_snapshots` are a rebuildable retrieval cache, not a trusted source of facts. A snapshot may summarize confirmed memories, logged source records, open follow-ups, and suggested memories, but canonical facts must remain in `people`, `source_records`, `memories`, and `followups`.

Agent answers and brief reasons should still preserve source references when making claims. This gives Tendnote faster context loading without creating a second memory store that can drift from the underlying records.
