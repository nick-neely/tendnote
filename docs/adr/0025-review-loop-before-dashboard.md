# Review Loop Before Dashboard

Phase 1A should build the source record and suggested-memory review loop before a broader dashboard. The first useful UI should let the user inspect a source record, save, edit, or dismiss suggested memories, and accept or dismiss any linked suggested follow-up.

This review loop is the product surface that validates the source-record, memory lifecycle, and trust-policy architecture. Dashboards and briefs should build on reviewed relationship context rather than exposing unproven extraction behavior at larger scale.

## Update (2026-06-26)

The review loop is built, so the dashboard now builds on it as intended rather than competing with it. The dashboard's right rail surfaces the open suggested-memory reviews across all people as a short "Needs review" list with inline Save (approve) / Dismiss, replacing the earlier "Recent notes" read-only list. This is the dashboard standing on the reviewed-context plumbing, not a second review system: it reuses the same owner-scoped review mutations, and the person ledger remains the home for the full review (edit wording, sensitivity, archive). It stays calm — a handful of the most important suggestions, no count badge, and the whole section hides when nothing is waiting; the long tail lives on each person's page. See [0026](0026-conversational-review-surface.md) for the same actions inside chat.
