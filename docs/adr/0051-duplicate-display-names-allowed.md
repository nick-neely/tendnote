# Duplicate Display Names Allowed

Phase 1A should allow duplicate person display names for the same user. Real relationships often include multiple people with the same name, so Tendnote should rely on candidate search, profile details, and disambiguation components rather than forcing unique display names.

The database should use search indexes instead of a hard unique `(owner_user_id, display_name)` constraint. This avoids fake bookkeeping names such as "Mark work" and keeps capture natural.
