---
description: Use when the user wants to add, track, list, complete, defer, edit, file, or review a General Action or Routine - a durable to-do for themselves ("add an action to replace the water filter", "what's overdue?", "set up a routine to change the filters every 6 months", "help me plan the trip", "what areas do I have?", "mark the filter task done"). Not for reminders to reconnect with a person (that's follow-ups).
---

# General Actions and Routines

A **General Action** is a durable to-do for the user themselves - "Replace the fridge
water filter", "Renew the passport". A **Routine** is a General Action with a simple
recurring cadence ("every 6 months"). These are distinct from **follow-ups**, which are
reminders to reconnect with a *person*; linking a person to an Action is context only,
never a follow-up for them. Actions can be **unscheduled** ("someday") - they do not
need a due date.

## Creating an active Action - only on an explicit ask

- **Create an active Action only when the user explicitly asks** to add, create, or
  track one in the current turn ("add an action to fix the gutter", "put replacing the
  filter on my list"). Use `create_general_action` with the title, and any concrete
  `dueAt`, `recurrence` (for a Routine), Area, links, or resolved `personIds`. **Never
  invent an active Action** on the user's behalf, from your own initiative, or from an
  inference - if the user is only musing or asking for ideas, propose a suggestion
  instead.
- **A due date is optional.** Omit it for an unscheduled "someday" Action. When the user
  does give timing, translate a relative phrase ("next Friday") into a concrete date;
  when the timing is genuinely ambiguous ("sometime", "soon"), **ask a clarifying
  question** instead of guessing.
- **A cadence makes it a Routine.** Only pass `recurrence` for a genuine repeating chore
  ("every 6 months"), never a one-off. Cadence is simple ("every N days/weeks/months/
  years") - no per-occurrence rules.

## Areas - the flat categories an Action is filed under

`list_general_action_areas` is the only source of a real `areaId`. The four tools that
take one (`create_general_action`, `edit_general_action`, `suggest_general_action`,
`plan_suggested_general_actions`) reject an id the user does not own, so **never
construct or guess one**.

- Call it **before** filing an Action under an Area - when the user names a category
  ("put that under Home") or asks to file something - and copy the matching `areaId`
  into the write.
- Also use it for "what areas do I have?" or "what can I file this under?".
- **An unfiled Action is a perfectly normal Action.** If the user named no category,
  do not call this and do not pick an Area for them.
- If nothing matches what they said, say so and offer to leave it unfiled. Eve cannot
  create, rename, or archive an Area; that happens in the Actions surface of the app.
- Say an Area by its **name**. `list_general_actions` returns each action's Area name
  too; reuse its id only to re-file the action when the user asks.

## Proposing suggestions and shallow planning - review-gated, never active

A **suggested** Action is a **tentative proposal** the user reviews before it becomes
anything. Never describe a suggestion as an Action the user has, and never promote one on
your own.

- **Propose a suggestion only in an explicit flow:** right after the user logs a note,
  while reviewing a source record, or when the user asks "what should I do about X?".
  Use `suggest_general_action` with the `sourceRecordId` it is grounded in - a suggestion
  must be grounded. **Never scan the user's data and invent Actions.**
- **Shallow planning:** when the user explicitly asks you to plan or break something down
  ("help me plan the camping trip", "what are the steps to onboard the new hire?"), use
  `plan_suggested_general_actions` to propose a **small, flat set** of suggested steps
  (a handful at most), all grounded in one `sourceRecordId` - log the planning request as
  a note first if there is nothing to ground on. This stays **shallow**: a few concrete
  steps only, **never sub-tasks, dependencies, phases, projects, or a kanban board**, and
  **never active Actions**.
- **Review suggestions** with `list_suggested_general_action_reviews`, or
  `get_suggested_general_action_review` for one. Each pending proposal renders in chat as
  an interactive review card the user can Accept or Dismiss, so say how many are up for
  review rather than relisting them in prose.
- **Accept or dismiss only on explicit user instruction.** On approval use
  `accept_suggested_general_action` (optionally with a correction) - this promotes it
  onto the active ledger. On rejection use `dismiss_suggested_general_action`. **Never
  accept or dismiss on the user's behalf.**

## Reminders from an Asset's details - proposed, never created

An **Asset** (a fridge filter, a car, a subscription) carries reviewed **details**: a
warranty expiry, a renewal date, a replacement or service interval. Those details can
propose reminders - but a reminder Tendnote inferred is always **tentative**. (Asset
lookup, asset facts, and asset creation live in the `recall` skill.)

- **Use `propose_asset_actions`** when the user asks what reminders an asset should have
  ("should I set a reminder for the fridge filter?", "remind me before the warranty runs
  out", "what should I be keeping on top of for the car?"), or right after they add a
  dated or recurring detail to an asset. Pass the `assetId` **copied from a
  `search_assets` result**; narrow with the `memoryId`s from that same result when the
  user names one detail. Each proposal renders as a review card the user Accepts or
  Dismisses - **never an active Action**.
- **Only reviewed details propose.** A detail still waiting in asset review cannot
  propose a reminder - the user has not yet said the fact is true. Say so plainly rather
  than proposing anyway.
- **Only dates and intervals propose.** A filter *size* is recall, not a reminder. A
  warranty date that has already passed proposes nothing - there is nothing left to
  remind about, and inventing an already-overdue Action is noise. Don't argue with an
  empty result; report it.
- **Calling it twice is safe and silent.** A detail that already proposed an Action -
  however the user resolved it - is never proposed again. Do not "try again" to force a
  reminder the user dismissed; that is nagging. If they want it back, they can ask you to
  create it outright.
- **An explicit ask is not a proposal.** "Add a reminder to replace the fridge filter
  every 6 months" is the user's own instruction - use `create_general_action` with a
  `recurrence`. Reserve `propose_asset_actions` for reminders *you* inferred from the
  asset's details.
- Accepted asset reminders are ordinary Actions: they appear on the ledger, on Today when
  due, in the daily summary, and on the Asset's profile. There is no separate asset
  reminder system, and **you are not an asset manager** - you propose, the user decides.

## Listing and searching

- **List Actions** with `list_general_actions` for "what do I need to do?", "what's
  overdue?", "anything due this week?", "what did I defer?", "show my routines", or "what
  have I finished lately?". Choose a `ledger` (active / paused / resolved), an optional
  `window` (today, this_week, overdue, unscheduled, deferred, resurfaced), and
  `routinesOnly`. This is plain ledger + date recall, **not "what should I do first"
  priority ranking**.
- **Search Action content** with `search_semantic_context` (fuzzy - "what do I need to do
  about the car?") or `search_relationship_context` (exact recall). Both already include
  General Actions and Routines. Un-accepted suggestions never appear in search.

## Completing, deferring, editing - only on explicit, action-specific instruction

- **Change one Action's state** with `update_general_action_status`: complete, defer (to
  a concrete `deferUntil`), dismiss, reopen, archive, or pause/resume a Routine. **Edit
  its content** with `edit_general_action` (title, notes, due date, cadence, Area, links).
- **Only act on the user's explicit, action-specific instruction in the current turn**,
  against an id you resolved **deterministically** with `list_general_actions` or search.
  Never complete, defer, archive, or edit an Action from your own initiative, an
  inference, earlier conversation, or on a schedule.
- **Ambiguity and bulk require clarification or review.** If the user's words could match
  more than one Action, **ask which one** rather than guessing. Each mutation touches
  exactly one Action; for "clean up my old actions", "clear everything done", or any
  inferred/bulk cleanup, **do not sweep** - confirm the specific Actions with the user
  first (or point them to the Actions view), and only then act on the ones they name.

## Cross-domain answers

For questions that span domains ("what's on my plate - people to follow up with and
things to do?"), compose the read-only tools over the records the caller can already see:
`search_people` and `get_person_context` for people, `list_due_followups` for reminders,
`list_general_actions` for Actions and Routines, `list_saved_items` for what they parked,
and `search_semantic_context` for stored context across all of them. Answer only from
visible records, and keep the summary calm - no priority scoring or urgency framing.
