# Follow-Up Lifecycle Includes Review-Gated Suggestions

Phase 1E should implement one follow-up lifecycle covering both user-created active reminders and review-gated agent-suggested follow-ups. Manual follow-ups prove the core reminder contract: person links, due dates, statuses, snooze, complete, dismiss, reopen, archive, audit logging, and later brief inclusion. Suggested follow-ups can share the same lifecycle, UI components, Eve components, and mutations as long as they remain `suggested` until explicitly accepted.

User-created follow-ups create active `open` reminders. Agent-suggested follow-ups create `suggested` records only, must be grounded in a source record, approved memory, retrieval result, or explicit user conversation context captured as a source record, and must never silently become active reminders. Accepting a suggestion promotes it to `open`; dismissing it prevents the same suggestion from returning through normal reminder feeds.

Suggested follow-up generation in Phase 1E should be triggered only from an explicit user or Eve flow, such as logging a note, reviewing a source record, approving a memory, viewing a person, or asking whether to follow up. Phase 1E should not add a background scanner that periodically reviews all relationship context and invents suggested follow-ups; later agenda and brief surfaces may rank existing suggested follow-ups, but they should not hide follow-up creation inside broad relationship review.

Every Phase 1E follow-up should have a concrete `dueAt` before it is saved, including suggested follow-ups. Eve may help translate phrases like "soon" or "next week" into a proposed date, but it should ask for clarification when the timing is ambiguous. Phase 1E should not add a vague "someday" reminder bucket.

Phase 1E should defer true recurring follow-up behavior. The existing `cadence` field may remain as inert metadata, but completing, snoozing, or editing a follow-up should not automatically generate the next instance yet. One-off reminders plus snooze are enough to prove the lifecycle before recurrence interacts with agenda and brief ranking.

Suggested follow-up review should reuse the existing review surfaces rather than create a separate follow-up inbox. Suggested follow-ups can appear on the person ledger, the dashboard review rail, and Eve chat cards; active follow-ups can appear on person profiles and the dashboard. This keeps review in context and avoids turning Tendnote into task-management UI.

Phase 1E still excludes proactive cross-person agenda ranking, persisted daily briefs, Calendar-derived follow-ups, external sends, shared household reminders, and autonomous outreach. Those later surfaces may consume reviewed follow-ups, but they should not own the core follow-up lifecycle.
