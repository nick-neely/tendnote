# Source Record Metadata Is Non-Authoritative

Phase 1A source records may include `metadata_json` for flexible source-specific details such as channel, location, provider ids, import filenames, or calendar event references. This metadata is useful for display, debugging, and future integration context, but it should not become the only place important product behavior lives.

If Tendnote needs to query, enforce, or rank by a metadata field, that field should graduate into a typed column or related table.
