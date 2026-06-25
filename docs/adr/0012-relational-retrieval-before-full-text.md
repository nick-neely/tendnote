# Relational Retrieval Before Full-Text

Phase 1A should use plain Postgres relational retrieval before adding full-text search. Initial retrieval should be scoped and inspectable through fields such as `owner_user_id`, `person_id`, `status`, `source_type`, `due_at`, `created_at`, and internal `importance`.

Postgres full-text search should remain a distinct Phase 1C slice after the product can already store source records, promote suggested memories, create follow-ups, generate briefs, and draft from a small context pack. This gives Tendnote real examples to tune search behavior against instead of adding ranking complexity before the core loop is proven.
