---
description: Use when the user logs a note, says remember/save/note/keep track of something, adds a person, edits a person's profile details (name, birthday, relationship, closeness), or wants to see, approve, or dismiss suggested memories ("what do I have to review?", "anything to review for Mara?"). For a fact about a thing the user owns (an appliance, vehicle, subscription, service, or household item), the capture path is different — see the recall skill's asset section.
---

# Adding people

Before linking any context to a person, use `search_people` to find existing matches.
How you proceed depends on what you find and what the user intends:

- **Explicit add-person intent** ("add Mara", "create a person for my coworker Sam",
  "I met Priya, add her") → use `create_person`. This is the **only way a new person
  is created**, and it requires a clear instruction to add or create someone.
- **One confident match** → reuse that person; do not create a duplicate.
- **Multiple matches (same or similar name)** → ask the user which person they mean.
  Never guess. `search_people` returning **more than one candidate** means you must
  disambiguate before linking.
- **A casual or ambiguous mention with no explicit add request** → **do not create a
  person**. Capture the note as a personless source record (`capture_source_record`
  with no `personId`) or ask who they mean. A passing mention is **never a reason to
  grow the people list**.

# Updating a person's profile

When the user wants to change a person's **profile attributes** — their display name,
first/last name, birthday, relationship type, closeness, or one-line blurb — resolve
the person with `search_people`, then use `update_person` with the `personId` and only
the fields that change. Examples: "change Mara's birthday to March 3", "rename Sam to
Samuel", "mark Theo as a colleague".

This is distinct from memories: profile fields are structured attributes of the person,
**not facts you remember about them**. A birthday, a name, or a relationship type goes
through `update_person`; "Mara is vegetarian" or "Sam is job hunting" is a memory
(`capture_memory`) and a passing observation is a source record (`capture_source_record`).

A direct request to save a general note, link, or open question that is not about a
person uses `capture_saved_item`. Ordinary questions remain conversation-only and must
not call a capture tool.
If the user immediately corrects or undoes that general capture, use
`change_saved_item_capture` or `undo_saved_item_capture` with the persisted Saved Item id.
Pass a birthday as YYYY-MM-DD when the year is known, or --MM-DD for month/day-only
birthday data. Do not invent a fake year. Resolve relative phrasing against today's
date. Pass `null` to clear a clearable field.

# Capturing notes vs. memories

Choose the right action for what the user is doing:

- **Casual note** ("Had lunch with Mark, he might be switching jobs") →
  `capture_source_record`. This logs context, not a confirmed fact. Pass `personId`
  only when the person is unambiguous; if identity is unclear, ask the user to
  disambiguate rather than guessing or inventing a person.
- **Explicit memory** ("Remember/save/note/keep track of …") → resolve the person,
  then `capture_memory`. This creates a durable approved fact with a source record for
  provenance. Include source, confidence, sensitivity, and timestamp.
- **Never invent a durable fact.** When you are unsure, capture a source record or
  ask, instead of stating something as confirmed.

**A fact about a thing is not a note about a person.** "The filter in my kitchen fridge
is EDR1RXD1", "the dishwasher warranty ends in March", "the car is due for an oil change
every 6 months" are **Asset** facts: they do not go to `capture_source_record` or
`capture_memory`, which are for people. Use `search_assets` to find the thing, then
`propose_asset_memories` — the fact becomes a **review card**, never a save. Say it is
waiting for review; never say you saved, logged, or recorded it. Even an explicit
"remember that the filter is EDR1RXD1" is proposed, not saved: there is no tool that
writes an asset fact directly. The recall skill has the full workflow.

When you log a casual note, the background extractor mines it into **suggested
memories** the user reviews later. The user can also approve a logged note inline the
moment you save it — which pre-approves whatever that note is extracted into — so a
plain `capture_source_record` is enough; you do not propose memories yourself.

# Reviewing suggested memories

Suggested memories come from logged context and are **tentative until the user
approves** them:

- When the user wants to **see or act on** suggested memories ("what do I have to
  review?", "anything to review for Mara?", "review Mara's suggestions"), call
  `list_suggested_memory_reviews` — pass the resolved `personId` to scope to one
  person, or omit it for everything across all people. It returns every open
  suggestion as an interactive review card the user can approve or dismiss inline, in
  one call. Do NOT answer this from `get_person_context` prose. Keep your own text to a
  brief lead-in ("Here's what's waiting for Mara") — the cards carry the wording,
  source framing, and actions, so don't re-enumerate them or restate status in prose.
- Use `get_suggested_memory_review` only to pull up one specific suggestion by id in
  detail.
- On explicit approval, use `approve_suggested_memory` (optionally with edits) to save
  it as a durable fact.
- On explicit rejection, use `dismiss_suggested_memory`.
- The user can also act on the card's buttons themselves. Either way, never approve or
  dismiss on the user's behalf, and never state a suggested memory as a fact before it
  is approved.

Tool outputs carry **persisted record ids** so you can render review surfaces and make
follow-up calls; the conversation explains records but is **not the source of truth**.
Surface the person's name and the record's content to the user — never the id itself.
