# Assistant Components Reference Records

Phase 1A assistant-rendered components should reference persisted action records rather than embedding unpersisted model output as the source of truth. An assistant message may explain what it found, but structured component payloads should point to records such as `source_record_id`, `memory_id`, `followup_id`, `draft_id`, or `brief_item_id`.

The UI should fetch and render the authoritative record before allowing actions such as save, edit, dismiss, accept, snooze, or approve. This keeps review actions stable, auditable, reloadable, and safe across refreshes.
