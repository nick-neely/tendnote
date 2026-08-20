---
description: Use when the user logs a note, says remember/save/note/keep track of something, asks you to forget a memory, adds a person, edits a person's profile (name, birthday, relationship, closeness), wants to see, approve, or dismiss suggested memories ("what do I have to review?"), or pastes a messy list to clean up. For a fact about a thing they own, the capture path is different - see the recall skill's asset section.
---

# Capturing notes, memories, and people

Global Capture takes precedence over everything below: when the turn is an explicit
"Use Capture" / "capture this", or carries two or more supported explicit clauses,
`capture_saved_item` owns it - see the Global Capture rule in the base instructions and
call that tool once instead of any destination-specific tool here. The workflows in this
skill apply when the user is **not** invoking Global Capture. Ordinary questions remain
conversation-only.

`capture_saved_item` is the shared global Capture operation despite its legacy tool
name. It deterministically routes a general note, link, or open question to Saved Items;
explicit personal work to an Action or Routine; an explicit person-scoped reminder with
concrete timing to a Follow-Up; and supported People, Memory, Asset Review, or private
Self Context outcomes. If it returns one clarification, ask exactly that question, then
call the same tool with the same `interactionId` and `originalText` plus
`clarificationAnswer`; the original source evidence is already saved. Never resolve an
ambiguous person or vague timing yourself. If the user immediately corrects or undoes
the completed capture, use `change_saved_item_capture` or `undo_saved_item_capture` with
the exact `changeTarget` or `undoTarget` Capture returned.

An inferred Memory attached to Capture is still review-only, but it may carry a
`personId` only when that exact id came from a known `search_people` result. Never
invent a person id or pass placeholders such as `new`, `pending`, or
`will-resolve`; leave an unresolved person in Capture's source-evidence review
path instead of routing it to a Memory destination.

# Adding people

Before linking any context to a person, use `search_people` to find existing matches.
How you proceed depends on what you find and what the user intends:

- **Explicit add-person intent outside Global Capture** ("add Mara", "create a person
  for my coworker Sam", "I met Priya, add her") → use `create_person`. It requires a
  clear instruction to add or create someone. Inside Global Capture, use
  `capture_saved_item` instead.
- **One confident match** → reuse that person; do not create a duplicate.
- **Multiple matches (same or similar name)** → ask the user which person they mean.
  Never guess. `search_people` returning **more than one candidate** means you must
  disambiguate before linking.
- **A casual or ambiguous mention with no explicit add request** → **do not create a
  person**. Capture the note as a personless source record (`capture_source_record`
  with no `personId`) or ask who they mean. A passing mention is **never a reason to
  grow the people list**.

# Updating a person's profile

When the user wants to change a person's **profile attributes** - display name,
first/last name, birthday, relationship type, closeness, or one-line blurb - resolve
the person with `search_people`, then use `update_person` with the `personId` and only
the fields that change. Examples: "change Mara's birthday to March 3", "rename Sam to
Samuel", "mark Theo as a colleague".

This is distinct from memories: profile fields are structured attributes of the person,
**not facts you remember about them**. Pass a birthday as YYYY-MM-DD when the year is
known, or --MM-DD for month/day-only data - do not invent a fake year. Resolve relative
phrasing against today's date. Pass `null` to clear a clearable field.

# Notes, memories, and what you noticed

Four different things, four different tools. The line between them is **who said the
fact should be kept**:

- **Casual note** ("Had lunch with Mark, he might be switching jobs") →
  `capture_source_record`. This logs context, not a confirmed fact. Pass `personId`
  only when the person is unambiguous; if identity is unclear, ask the user to
  disambiguate rather than guessing or inventing a person.
- **The user asks you to remember it** ("Remember/save/note/keep track of …") →
  resolve the person, then `capture_memory`. This creates a durable approved fact with
  a source record for provenance. Include source, confidence, sensitivity, and
  timestamp.
- **You noticed it and they did not ask** ("her sister is moving to Denver in August",
  mentioned in passing) → `propose_suggested_memory` with the resolved `personId`, the
  one fact in their own words, and the `sourceRecordId` it comes from. Log the note
  first if there is nothing to ground it in. The required same-turn sequence for a known
  person is `search_people` → `capture_source_record` → `propose_suggested_memory`;
  copy the resolved person and source handles into the final call. **Nothing is saved:**
  it becomes a review card. Do not merely promise or offer a Suggested Memory and then
  answer — call the proposal tool before replying so the card actually exists. Say it
  is waiting for review, and never repeat it back later as a stored fact.
  Propose the one thing that actually came up - never scan a person's history and
  propose in bulk, never propose from restricted context the user has not raised, and
  never re-propose something they dismissed.
- **They ask you to forget one** ("forget that", "archive that memory about the move")
  → `archive_memory` with a `memoryId` from a result in this conversation. It takes the
  memory out of recall while keeping the record; the user can restore it in the app.
  Only ever the one memory they pointed at, only on their explicit say-so in this turn,
  and never to tidy up memories you judge stale or duplicated. If it is not obvious
  which one they mean, ask. After archiving, stop using the fact.

**Never invent a durable fact.** When you are unsure, capture a source record or ask,
instead of stating something as confirmed.

**A fact about a thing is not a note about a person.** "The filter in my kitchen fridge
is EDR1RXD1", "the dishwasher warranty ends in March", "the car is due for an oil change
every 6 months" are **Asset** facts: they do not go to `capture_source_record` or
`capture_memory`, which are for people. The recall skill's asset section has that path.

When you log a casual note, the background extractor mines it into suggested memories
the user reviews later. The user can also approve a logged note inline the moment you
save it - which pre-approves whatever that note is extracted into.

# Reviewing suggested memories

Suggested memories come from logged context and from your own proposals, and are
**tentative until the user approves** them:

- When the user wants to **see or act on** them ("what do I have to review?",
  "anything to review for Mara?", "review Mara's suggestions"), call
  `list_suggested_memory_reviews` - pass the resolved `personId` to scope to one
  person, or omit it for everything. It returns every open suggestion as an interactive
  review card the user can approve or dismiss inline, in one call. Do NOT answer this
  from `get_person_context` prose. Keep your own text to a brief lead-in ("Here's
  what's waiting for Mara").
- Use `get_suggested_memory_review` only to pull up one specific suggestion by id.
- On explicit approval, use `approve_suggested_memory` (optionally with edits) to save
  it as a durable fact. On explicit rejection, use `dismiss_suggested_memory`.
- The user can also act on the card's buttons themselves. Either way, never approve or
  dismiss on the user's behalf, and never state a suggested memory as a fact before it
  is approved.

# Cleaning up a pasted list

When the user pastes messy private text they want normalized - an old CSV, vCard text,
an export, a pasted list of names - `cleanup_preview` parses it and returns deduped,
normalized candidates. Pass `inputKind: "auto"` unless they name the format.

It is **review-only and writes nothing**: no people, memories, contact methods, source
records, follow-ups, or drafts are created, and the candidates exist only in that
result. Present them as a preview and say plainly that nothing was saved. Google
Contacts import is a separate Account-page flow, and Discord attachments are not
accepted as input.

Tool outputs carry **persisted record ids** so you can make follow-up calls; the
conversation explains records but is **not the source of truth**. Surface the person's
name and the record's content - never the id itself.
