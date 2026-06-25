# Source Records Track Unresolved Mentions

Phase 1A should store unresolved person mentions explicitly instead of treating an entire source record as blocked by one ambiguous name. A source record can link resolved people through `source_record_people` and track unresolved mentions with status, mention text, candidate people, and an optional linked person once resolved.

This allows partial progress on multi-person notes: resolved people can feed their profiles and extraction while unresolved mentions remain reviewable.
