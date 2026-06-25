# Source Records As Evidence Layer

Phase 1 uses `source_records` as the canonical evidence layer for logged context, including manual notes, interaction summaries, import previews, calendar summaries, future email summaries, and other raw-ish user-approved or provider-derived context. Memories point back to source records through `source_record_id`, and suggested memories represent extracted durable-context candidates from those records.

Interactions are a source record type, not a separate table by default. A dedicated `interactions` table should only be added later if interactions gain behavior that `source_records` cannot represent.
