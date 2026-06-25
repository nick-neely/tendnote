# Conversation Is Not Source Of Truth

Phase 1A conversation history should support UX continuity but should not become the source of truth for Tendnote state. Source records, memories, follow-ups, briefs, drafts, and audit logs own durable product behavior; assistant messages may explain or point to those records.

Full conversation persistence can be deferred or implemented as thin messages/events linked to persisted records. Suggestions, approvals, dismissals, and source explanations should remain reloadable and auditable outside the chat transcript.
