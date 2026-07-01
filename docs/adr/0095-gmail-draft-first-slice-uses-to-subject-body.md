# Gmail Draft First Slice Uses To Subject Body

Phase 2D should limit the first Gmail draft creation and update path to confirmed `to` recipients, an approved subject, and the approved message body. CC, BCC, and attachments should wait for later explicit phases because they expand the recipient policy, privacy surface, and file-handling requirements beyond the core external draft write boundary. This keeps the first Gmail slice focused on consent, provider authorization, idempotent create/update behavior, and recoverable failures.
