# Context Snapshots Are Cache

Phase 1B `person_context_snapshots` are a rebuildable retrieval cache, not a trusted source of facts. A snapshot may summarize confirmed memories, logged source records, open follow-ups, and suggested memories, but canonical facts must remain in `people`, `source_records`, `memories`, and `followups`.

Snapshots should store generated summary text plus supporting record references, not independent claim fields that users correct directly. Agent answers and brief reasons should still preserve source references when making claims. This gives Tendnote faster context loading without creating a second memory store that can drift from the underlying records.

Snapshot staleness should be deterministic and record-driven. A snapshot becomes stale when the linked person's profile fields, visible memory lifecycle state, linked active source records, review-visible suggested memories, or relevant follow-up state changes; Eve and web surfaces may rebuild stale snapshots through shared code, but they should not make snapshot freshness depend on an agent request alone.

Phase 1B mutations should make staleness detectable rather than synchronously generating prose. A shared snapshot builder/read path should rebuild missing or stale snapshots for web and Eve, while later mutation hooks, cron, or queue jobs may prewarm snapshots as an optimization.

Snapshot reads should fail open to the trust-aware relational context from Phase 1A. If a snapshot is missing, stale, or fails to rebuild, web and Eve should still be able to load approved memories, active source records, review-visible suggestions, and relevant follow-ups with source references; snapshot failure should be observable, but it should not block profile or assistant context retrieval.

Suggested memories should not be blended into the main generated summary as profile facts. They may appear only as clearly separated review hints or supporting references, while the durable summary should be generated from the person record, approved memories, source-grounded logged context, and relevant follow-ups according to the context trust policy.

Follow-ups may appear in snapshots only as compact contextual references, such as active or recently completed reminders with their ids, statuses, due dates, and reasons. Follow-up lifecycle behavior remains owned by `followups`; the snapshot should not become a reminder feed or scheduling model.

Users should not edit generated snapshot text directly in Phase 1B. If a snapshot is wrong, Tendnote should correct the underlying person, memory, source record, suggested memory, or follow-up, then rebuild the snapshot; source-reference affordances can explain why text appeared without turning the cache into an editable profile.

Phase 1B source references should be record-level rather than sentence-level. Snapshots may keep supporting memory, source record, suggested memory, and follow-up ids, and every generated claim should be defensible from those records; Eve and web should fetch supporting records before making specific answers or draft claims.

Phase 1B should keep one current snapshot row per owner and person, not versioned snapshot history. The current row can track generation time, staleness, input fingerprint, generator version, and supporting record ids; if historical debugging or evals become necessary later, Tendnote can add a separate log without making the cache read path ambiguous.

Phase 1B may use LLM-generated prose for richer snapshots immediately, but generation should sit behind a shared builder contract. Shared code should own loading trusted inputs, applying policy filters, storing the snapshot, and preserving supporting references; the LLM adapter should only turn the approved input pack into prose and should be replaceable with a deterministic generator for tests, fallback, or future tuning.

The snapshot builder should be shared package-level product code, not Eve-owned tool logic or raw database plumbing alone. Web and Eve should call the same owner-scoped builder/read path so policy filtering, freshness checks, generation, fallback, and source references behave consistently across surfaces.

Default snapshots should exclude restricted context even when a person profile is opened. If the user directly asks about restricted context and access rules allow it, Tendnote should fetch supporting restricted records through the live retrieval path rather than baking them into the cached profile card.

Successful snapshot rebuilds should not create normal audit log entries. Snapshot rows should carry operational metadata such as generation time, generator version, freshness inputs, and optional failure details; audit logs should remain focused on user-visible or approval-relevant changes to source records, memories, follow-ups, drafts, and profile data.

The web UI may expose the snapshot as a read-only generated relationship card on a person profile so users can inspect the context Eve may carry forward. Correction actions should route to the underlying records rather than editing snapshot text, and the snapshot should not become the primary profile editor.
