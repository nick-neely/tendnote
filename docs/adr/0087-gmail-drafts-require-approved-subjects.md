# Gmail Drafts Require Approved Subjects

Phase 2D Gmail draft creation should require an approved subject along with the confirmed recipient and approved message body. Tendnote may generate a suggested subject from the internal draft context and let the user edit it during approval, but the final subject should be persisted on the Gmail draft action record before the external write. This keeps created Gmail drafts inspectable and intentional without forcing non-email Tendnote draft channels to carry subject fields.
