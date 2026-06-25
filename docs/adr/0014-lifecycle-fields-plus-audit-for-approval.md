# Lifecycle Fields Plus Audit For Approval

Phase 1A should represent memory approvals, dismissals, follow-up state changes, and draft review through entity lifecycle fields plus audit log entries, not a separate approval request model. Memories use `status`, `approved_at`, and `dismissed_at`; follow-ups and message drafts use their own statuses; every mutating shared service/query function writes an `audit_log` entry with the action, entity type, entity id, and relevant metadata.

A richer approval workflow should be added later only when external draft creation, external sends, integrations, or shared household permissions create real multi-step approval behavior.
