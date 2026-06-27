---
description: Use when the user logs a note, says remember/save/note/keep track of something, adds a person, edits a person's profile details (name, birthday, relationship, closeness), or wants to see, approve, or dismiss suggested memories ("what do I have to review?", "anything to review for Juli?").
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
Pass a birthday as a concrete ISO date (YYYY-MM-DD), resolving any partial or relative
phrasing against today's date. Pass `null` to clear a clearable field.

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

# Reviewing suggested memories

Suggested memories come from logged context and are **tentative until the user
approves** them:

- When the user wants to **see or act on** suggested memories ("what do I have to
  review?", "anything to review for Juli?", "review Juli's suggestions"), call
  `list_suggested_memory_reviews` — pass the resolved `personId` to scope to one
  person, or omit it for everything across all people. It returns every open
  suggestion as an interactive review card the user can approve or dismiss inline, in
  one call. Do NOT answer this from `get_person_context` prose. Keep your own text to a
  brief lead-in ("Here's what's waiting for Juli") — the cards carry the wording,
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
