# Gmail Uses Incremental Google Capability Consent

Phase 2D Gmail draft creation should reuse Better Auth's Google account linking and token custody pattern, but it should remain a separate Tendnote Provider Connection capability from Calendar. Gmail should request only the narrow draft-write scope needed for create/update behavior through explicit incremental consent, and `google/gmail` status, scopes, errors, and revocation should be tracked independently from `google/calendar`. This lets one Google account support multiple capabilities without collapsing product consent boundaries.
