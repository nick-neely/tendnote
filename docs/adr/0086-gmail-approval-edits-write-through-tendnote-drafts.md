# Gmail Approval Edits Write Through Tendnote Drafts

Phase 2D may allow last-mile subject, body, or recipient edits in the Gmail draft approval flow, but edits to the message content should be persisted back through the Tendnote message draft lifecycle before creating the external Gmail draft. The Gmail write should use the exact approved Tendnote draft snapshot and confirmed external draft recipient metadata, not an unpersisted modal-only variation. This keeps the Gmail path seamless without splitting the source of truth between Tendnote draft records and provider draft payloads.
