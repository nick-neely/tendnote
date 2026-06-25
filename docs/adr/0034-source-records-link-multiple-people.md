# Source Records Link Multiple People

Phase 1A source records should support links to multiple people through a join table rather than storing a single `person_id` on `source_records`. A source record may mention one or more people, with link roles such as `primary` or `mentioned`, while extracted memories remain person-specific through `memories.person_id`.

This models real notes such as dinners, calls, and group events without duplicating the source record or forcing unrelated facts into one person's profile.
