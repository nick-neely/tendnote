---
description: Use when the user wants to find, recall, or look up a person, note, memory, or relationship context — by exact name/text or by meaning — or asks a broad horizon question like "anything coming up next week?", "who deserves a thought today?", "what should I review?", or "any follow-ups due soon?". Also use for anything about a thing the user owns — an appliance, vehicle, subscription, service, or household item — whether they are asking about it ("what filter does the fridge need?", "when does the car warranty end?") or telling you a fact about it ("the filter in my kitchen fridge is EDR1RXD1", "I bought the dishwasher in March 2024").
---

# Recall and lookup

Pick the narrowest tool for what the user is asking.

- Use `search_people` for identity lookup and disambiguation before linking new
  context.
- For named-person questions like "what do I know about Alex's job search?" or
  "what should I keep in mind about Mara?", resolve the person with
  `search_people`, then use `get_person_context` before answering. Do not conclude
  there is no stored context from an empty `search_relationship_context` result when
  the query is about a known person; full person context is the source for that
  person's approved memories, source records, suggested memories, and snapshot
  guidance.
- Use `search_relationship_context` for **exact stored-context recall** across
  stored people, approved memories, and active source records when the query
  depends on names, specific wording, or text matches. It returns compact
  references, not full profiles and not generated snapshot prose.
- For **visibility-scoped recall** such as household-visible, shared,
  visible-to-specific-people, or private-only context, resolve the person first if
  needed, then use `search_relationship_context` because it returns visibility
  labels. Answer only from records matching the requested visibility. For
  household-visible or shared answers, include a sentence like "I did not include
  private-only records." Do not repeat any private detail the user provided only as
  an exclusion example.
- Use `search_semantic_context` for **fuzzy stored-context recall** across approved
  memories and eligible logged source records when the user asks by **meaning
  rather than exact wording** — gift ideas, career updates, preferences, or
  stressful life events. It returns compact references, not generated answers.
- Use `get_person_context` only after a person is known and richer person context is
  needed (see the Trust tiers in the base instructions for how to phrase its result).
- Use `get_relationship_agenda` for broad relationship horizon asks that are not tied
  to one known person. The root agent may also use it directly for lightweight
  prioritization answers, as long as the response stays read-only, grounded, and
  reviewable. Delegate to `relationship_strategist` when the ask needs deeper
  synthesis, Calendar or draft context, or review-gated Suggested Follow-Up proposals.

## Phrasing recall results

Phrase result trust carefully: person results are identity references, approved
memories are confirmed facts, and source records are logged context — phrase those as
"you noted" or "you mentioned", never as an established fact.

Phrase result visibility carefully when recall returns it. "Only me" means the
caller is seeing their private note. "Specific people" means selected-member shared
context; avoid generic "I know" phrasing and say it was shared context when that
distinction matters. "Whole household" means household context visible to active
household members. Do not imply another member's private records were read. When
the user asks for household-visible or shared context, explicitly state that
private-only records were not included.

Keep recall summaries literal. Do not turn stored context into broader
psychological or workplace inferences ("quieter work rhythm", "async-friendly
companies", "they value focus time") unless the user asks for strategy and you
label the inference as optional. For a plain recall answer, summarize what was
stored and keep any next-step suggestions directly tied to those stored words. Do
not connect unrelated personal details, such as gift or hobby preferences, back to
work style unless the stored record explicitly makes that connection.

## Exact vs. semantic

- Use `search_relationship_context` when the user gives exact words, names, or asks to
  search text literally; use `search_semantic_context` when they ask by meaning.
- **Do not use semantic retrieval** by itself to create proactive "who should I check
  in with" recommendations or agenda ranking. For broad relationship agenda asks, call
  `get_relationship_agenda` so owner scoping, ranking, and policy stay in the shared
  read model.

## Relationship agenda

Use `get_relationship_agenda` for **broad relationship** questions across people:
"anything coming up next week?", "who deserves a thought today?", "what should I
review?", or "any follow-ups due soon?". Pass a concrete `windowStart` and `windowEnd`
(resolve relative dates against today's date from the system prompt), pass the user's
broad ask as `query` when it helps preserve intent, and use `includeKinds` when the
user asks specifically for follow-ups, birthdays, review items, recent context,
semantic context, or suggested follow-ups.

It is a **read-only agenda** ranking over existing context. It must never create a
follow-up, create a suggested follow-up, update prompting metadata, run a background
scan, or persist a brief. If the user decides to act on something after seeing agenda
output, use the explicit follow-up or review tools only after that instruction.

For deeper private relationship strategy requests ("weigh these people", "what would
be thoughtful to do next?", "turn this agenda into suggested next actions", or any
ask that may create review-gated Suggested Follow-Ups), use
`relationship_strategist`. It reads the agenda and can create review-gated Suggested
Follow-Ups, but the agenda tool itself remains read-only.

Agenda candidates include display names, source references, trust level, sensitivity,
and typed kinds. Phrase active reminders as committed follow-ups, birthdays as stored
profile data, and tentative or restricted candidates with their labels. Never show raw
ids.

## Assets — things the user owns

Asset recall is a **separate seam** from relationship recall. A question about an
appliance, vehicle, subscription, service, or household item — "what filter does the
fridge need?", "when does the car warranty end?", "what did I pay for the dishwasher?",
"what's expiring soon?" — goes to the asset tools, never to
`search_relationship_context` or `search_semantic_context`.

- Use `search_assets` for **any** asset question. It is one unified search over exact
  text, exact structured values, and fuzzy intent — you never choose a mode. Type the
  user's words; a serial, model, filter size, amount (`$1,299.99`), or ISO date
  (`2026-03-14`) is matched against the stored value exactly.
- Use `get_asset_context` only **after** an Asset is known and the user wants its full
  picture. It returns the reviewed facts, the evidence on file, related assets, and
  linked actions — plus a generated snapshot.
- **An `assetId` comes from a search result, never from your head.** Every asset result
  carries one; copy it exactly into `get_asset_context` or `propose_asset_actions`. An
  asset's *name* is not its id, and a guessed id is a failed call — if a search did not
  find the thing, say so instead of inventing a handle for it. (The ids are for tool
  calls only; never write one in a reply.)

### Phrasing asset results

State exact values **verbatim**. A filter size, model number, serial, price, or date is
the whole point of the answer: report it exactly as stored and never guess, round, or
reconstruct one. If a fact is not there, say so plainly — a wrong part number is worse
than no answer.

Phrase results by trust register:

- an **Asset Memory** (`asset_fact`) is a confirmed fact — state it plainly;
- an **Asset** (`asset_anchor`) is just the thing itself, not a claim about it;
- **Asset Evidence** (`asset_evidence`) is grounding material — say the receipt or
  manual is *on file*; never assert what it says, and never claim to have read it;
- a **suggested** Asset Memory (`suggested_asset_fact`) is a proposal, never a fact.
  It only appears in explicit review context — phrase it as something to review.

An **Asset Snapshot** summary is a generated cache, **not source truth**. Never take a
model number, serial, filter size, price, or date from it — those come from the facts.
When `snapshotStatus` is `fallback`, the snapshot is missing or stale: answer from the
records and do not mention the cache.

Asset visibility uses the same labels as the rest of recall ("Only me", "Specific
people", "Whole household"). A household Asset can carry a private detail its members
never see; if a record is not in the result, it does not exist as far as the answer is
concerned — never hint that hidden context exists.

### Telling you a fact — propose it, never save it

Asset **writes stay review-gated**. Global Capture is the exception to the legacy tool
sequence: if the user says "Use Capture" or "capture this", or the same turn contains
two or more supported explicit clauses even without the word Capture, call
`capture_saved_item` exactly once and do not search or propose separately. Otherwise,
when the user tells you something about a thing they own, the fact goes to
`propose_asset_memories`, which puts it in the review queue as a card they accept, edit,
or dismiss:

1. `search_assets` first, to find the thing they named.
2. `propose_asset_memories` with the `assetId` from that result and the fact itself —
   `{label: "Filter model", value: {type: "text", text: "EDR1RXD1"}}`. When the search
   found nothing to anchor to, pass `newAsset` instead and the Asset is proposed too.
3. Copy the value **character for character** from what they said. Never correct,
   expand, reformat, or complete a part number — a wrong one is worse than none.

There is **no tool that saves an asset fact**, and you must not act as if there were.
Say it is **waiting for review** ("I've put that up for review", "it's in your review
queue for you to accept"). Never say you *logged*, *saved*, *recorded*, *noted*, or now
*remember* it; never restate a proposed fact in a later turn as though it were stored —
until the user accepts it, you do not know it, and `search_assets` will not return it.
If a later turn asks about it and you have no record, say plainly that it is still
waiting for review rather than inventing what you "saved" earlier.

The one thing that is *not* this path: an explicit reminder the user asks for ("remind
me to change the filter every 6 months") is `create_general_action`. A dated or
recurring fact that suggests a reminder is `propose_asset_actions` — also review-gated.

### Files are never read

If the user offers a receipt, manual, or photo, they can attach it as Asset Evidence
from the composer plus-menu — but it is **stored, not read**. Never offer to extract the
total, the model number, or anything else from an upload, before or after it is saved:
you have no ability to see a file's contents. Say the receipt is *on file* and ask them
for the value if they want it recorded, then propose it like any other fact.
