---
description: Use when the user wants to set, list, change, complete, snooze, or review a reminder/follow-up to reconnect with someone ("remind me to call Mara next week", "what's due this week?"), or to propose, accept, or dismiss a suggested follow-up.
---

# Active follow-ups

A follow-up is an active reminder to reconnect with a person for a reason at a concrete
time. Active follow-ups are real reminders the user committed to — distinct from
tentative suggested memories, which stay in review until approved.

- **Create a follow-up only when the user explicitly asks** to be reminded or to follow
  up ("remind me to call Mara next week", "I should follow up with Sam about the
  offer"). Resolve the person first with `search_people`, then use `create_followup`
  with the resolved `personId`, a clear reason, and a concrete `dueAt`. **Never invent
  an active reminder** on the user's behalf.
- **Every follow-up needs a concrete due date.** Translate a relative phrase like "next
  week" or "Friday" into a concrete date using today's date from the system prompt. But
  when the timing is ambiguous ("sometime", "soon", "later"), **ask a clarifying
  question** instead of guessing — do not create a follow-up for the wrong day.
- **List due follow-ups** with `list_due_followups` for "what's due today?", "what do I
  owe this week?", or "what follow-ups do I have for Mara?". Pass `window` (today or
  this_week) and/or a resolved `personId`. This is plain due-date recall, soonest first
  — **not a "who should I check in with" agenda** or priority ranking.
- **Change a follow-up's status** with `update_followup_status`: complete, dismiss,
  snooze (to a new concrete `dueAt`), reopen, or archive — only on the user's explicit
  instruction. Invalid transitions are rejected; never force one.

Follow-up tools return compact references with persisted ids for your tool calls. Always
refer to the person by name and the reminder by its reason — never show a raw id.

# Suggested follow-ups

A **suggested follow-up** is a **tentative proposal** the user reviews before it becomes
anything — distinct from an active follow-up, which is a real reminder the user
committed to. Keep that line sharp: never describe a suggestion as a reminder the user
has, and never turn one into an active reminder on your own.

- **Propose a follow-up only in an explicit flow:** right after the user logs a note,
  while reviewing a source record or memory, when viewing a person, or when the user
  asks whether they should follow up. Use `propose_followup` with the resolved
  `personId`, a reason, a concrete proposed `dueAt`, and the `sourceRecordId` it is
  grounded in. The result is a tentative review card, not a reminder.
- **Never scan everyone and invent follow-ups.** There is **no background follow-up
  generation** in this phase. **Do not use suggested-follow-up tools to propose
  reminders** for people the current conversation is not about from the root agent. For broad cross-person
  agenda lookup questions, use the **read-only `get_relationship_agenda` tool**. For
  broad private strategy requests that ask for recommended next actions, delegate to
  `relationship_strategist`; it may create review-gated Suggested Follow-Ups, never
  active reminders.
- **Restricted context is not used for proactive suggestions** by default. Only propose
  a follow-up grounded in restricted context when the user directly asked about that
  delicate topic (set `directlyRequested`).
- **Review suggested follow-ups** with `list_suggested_followup_reviews` (scope to a
  person with `personId`, or omit for all), or `get_suggested_followup_review` for one.
  They render interactive cards the user can accept or dismiss inline.
- **Accept or dismiss only on explicit user instruction or a card button action.** On
  approval use `accept_suggested_followup` (optionally with an edit to reason or due
  date) — this promotes it to an active reminder. On rejection use
  `dismiss_suggested_followup`. **Never accept or dismiss on the user's behalf.**
