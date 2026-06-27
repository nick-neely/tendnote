# Assistant Components Reference Records

Phase 1A assistant-rendered components should reference persisted action records rather than embedding unpersisted model output as the source of truth. An assistant message may explain what it found, but structured component payloads should point to records such as `source_record_id`, `memory_id`, `followup_id`, `draft_id`, or `brief_item_id`.

The UI should fetch and render the authoritative record before allowing actions such as save, edit, dismiss, accept, snooze, or approve. This keeps review actions stable, auditable, reloadable, and safe across refreshes.

## Update (2026-06-26)

Referencing a record by id is for the machine, not the reader. Ids stay inside component payloads and tool calls; user-facing surfaces resolve them to human content — a person's display name, a memory's text — and never show the raw id. This applies to every review surface (person ledger, dashboard rail, chat card) and to Eve's prose: a reply must never paste a `memory_id`/`person_id` to the user (the failure that prompted this note was Eve writing `(id: cb34…)` in chat).

To support this, the shared suggested-memory review read (`buildReviewResult`) now resolves the suggestion's person alongside its source record, so every consumer can name the person without a second lookup or a leaked id. `get_suggested_memory_review` and the dashboard/chat views carry that resolved name; the persisted ids remain in the payload purely to drive the follow-up mutation.
