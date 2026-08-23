---
description: Use when the user looks something up - a person, a note, a memory, stored context by wording or by meaning, a thing they own (appliance, vehicle, subscription, service, household item), their Calendar, their Saved Items - or asks a broad horizon question like "anything coming up next week?", "who deserves a thought today?", "what should I review?". Also use when they tell you a fact about a thing they own ("the filter in my kitchen fridge is EDR1RXD1", "I bought the dishwasher in March 2024").
---

# Recall and lookup

Pick the narrowest tool that answers the question. One search is usually enough; if it
comes back empty, say so rather than trying the same question through another tool.

| Ask | Tool | Not for |
|---|---|---|
| Cross-domain or unclear family - "where did I put that?" | `search_global_recall` | it searches, it does not act |
| Who is this person / disambiguation | `search_people` | it returns identity only, never their context |
| Everything about one known person | `get_person_context` | needs a resolved `personId` first |
| **Exact stored-context recall** - names, specific wording, text matches | `search_relationship_context` | returns compact references, not profiles or snapshot prose |
| **Fuzzy stored-context recall** - **meaning rather than exact wording** | `search_semantic_context` | never use it to rank people or build proactive suggestions |
| Anything the user owns | `search_assets` | not `search_relationship_context`; assets are a separate seam |
| One known Asset in full | `get_asset_context` | needs an `assetId` from a search result |
| Broad relationship horizon across people | `get_relationship_agenda` | read-only; it creates nothing |
| What is on their Calendar | `list_calendar_events` | read-only provider context, not stored memory |
| What they parked for later | `list_saved_items` | a recency browse, not a search |

Notes on the two that overlap most:

- `search_global_recall` returns the same typed Exact then Related results as Search,
  across People, Follow-Ups, Actions, Assets, Saved Items, and available Calendar
  context. Cite its canonical records, preserve its trust language, and state any
  limitations it reports. Source Records and Asset Evidence are grounding only, never
  independent answers.
- For a named-person question like "what do I know about Alex's job search?", resolve
  the person with `search_people`, then use `get_person_context`. Do **not** conclude
  there is no stored context from an empty `search_relationship_context` result when
  the query is about a known person: full person context is the source for that
  person's approved memories, source records, suggested memories, and snapshot
  guidance.

For **visibility-scoped recall** - household-visible, shared, visible-to-specific-people,
or private-only - `search_relationship_context` is the tool, because it returns
visibility labels. Answer only from records matching the requested visibility.
Set `visibilityScope: "shared"` for household-visible, shared, or specific-people
questions, and `visibilityScope: "private_only"` for Only-me/private-only questions.
Use `visibilityScope: "all_visible"` only when the user did not request a visibility
boundary. The tool filters disallowed records before they reach your context.
When that deterministic person-scoped search returns no matching records, stop:
answer with a plain scoped absence. Do not broaden into `search_semantic_context`,
`get_person_context`, or identity/profile fields to fill the answer, and do not repeat
an out-of-scope detail merely to explain that it was excluded.

## Exact vs. semantic

Use `search_relationship_context` when the user gives exact words, names, or asks to
search text literally; use `search_semantic_context` when they ask by meaning - gift
ideas, career updates, preferences, stressful life events.

**Do not use semantic retrieval** by itself to create proactive "who should I check in
with" recommendations or agenda ranking. For broad relationship agenda asks, call
`get_relationship_agenda` so owner scoping, ranking, and policy stay in the shared read
model.

## Phrasing recall results

Phrase result trust carefully: person results are identity references, approved
memories are confirmed facts, and source records are logged context - phrase those as
"you noted" or "you mentioned", never as an established fact.

Phrase result visibility carefully when recall returns it. "Only me" means the caller
is seeing their private note. "Specific people" means selected-member shared context;
avoid generic "I know" phrasing and say it was shared context when that distinction
matters. "Whole household" means household context visible to active household members.
Do not imply another member's private records were read. When the user asked for
household-visible or shared context, say plainly that private-only records were not
included.

Keep recall summaries literal. Do not turn stored context into broader psychological or
workplace inferences ("quieter work rhythm", "async-friendly companies", "they value
focus time") unless the user asks for strategy and you label the inference as optional.
For a plain recall answer, summarize what was stored and keep any next-step suggestions
tied to those stored words. Do not connect unrelated personal details, such as gift or
hobby preferences, back to work style unless the stored record explicitly makes that
connection.

## Relationship agenda

Use `get_relationship_agenda` for **broad relationship** questions across people:
"anything coming up next week?", "who deserves a thought today?", "what should I
review?", or "any follow-ups due soon?". Pass a concrete `windowStart` and `windowEnd`
(resolve relative dates against today's date from the system prompt), pass the user's
broad ask as `query` when it helps preserve intent, and use `includeKinds` when they
ask specifically for follow-ups, birthdays, review items, recent context, semantic
context, or suggested follow-ups.

It is a **read-only agenda** ranking over existing context. It must never create a
follow-up or suggested follow-up, update prompting metadata, run a background scan, or
persist a brief. If the user decides to act on something after seeing agenda output,
use the explicit follow-up or review tools only after that instruction. For deeper
strategy ("weigh these people", "turn this agenda into suggested next actions"),
delegate to `relationship_strategist` with the resolved `personId`s.

Agenda candidates include display names, source references, trust level, sensitivity,
and typed kinds. Phrase active reminders as committed follow-ups, birthdays as stored
profile data, and tentative or restricted candidates with their labels.

## Assets - things the user owns

This is the home for asset guidance; the other skills point here.

An asset question - "what filter does the fridge need?", "when does the car warranty
end?", "what did I pay for the dishwasher?", "what's expiring soon?" - goes to
`search_assets`, never to `search_relationship_context` or `search_semantic_context`.
`search_assets` is one unified search over exact text, exact structured values, and
fuzzy intent: you never choose a mode. Type the user's words; a serial, model, filter
size, amount (`$1,299.99`), or ISO date (`2026-03-14`) is matched against the stored
value exactly. Use `get_asset_context` only **after** an Asset is known and the user
wants its full picture - reviewed facts, evidence on file, related assets, linked
actions, plus a generated snapshot.

An `assetId` comes from a search result, never from your head. An asset's *name* is not
its id, and a guessed id is a failed call: if a search did not find the thing, say so.

### Phrasing asset results

State exact values **verbatim** (see the standing rule in the base instructions).
Phrase each result by its trust register:

- an **Asset Memory** (`asset_fact`) is a confirmed fact - state it plainly;
- an **Asset** (`asset_anchor`) is just the thing itself, not a claim about it;
- **Asset Evidence** (`asset_evidence`) is grounding material - say the receipt or
  manual is *on file*; never assert what it says, and never claim to have read it;
- a **suggested** Asset Memory (`suggested_asset_fact`) is a proposal, never a fact. It
  only appears in explicit review context - phrase it as something to review.

An **Asset Snapshot** summary is a generated cache, **not source truth**. When
`snapshotStatus` is `fallback` the snapshot is missing or stale: answer from the
records and do not mention the cache.

Asset visibility uses the same labels as the rest of recall. A household Asset can
carry a private detail its members never see; if a record is not in the result, it does
not exist as far as the answer is concerned - never hint that hidden context exists.

### Creating and renaming an Asset - explicit only

- **`create_asset`** when the user explicitly asks to start tracking a thing in this
  turn ("add my Corolla as an asset"). Run `search_assets` first: if they already have
  it, use that one rather than making a second. It is created private; who can see it
  changes in the app.
- **`edit_asset`** to rename one or correct the kind it was filed under, against an
  `assetId` you resolved deterministically. It changes what the thing is *called* and
  nothing else.
- Neither is for a thing you worked out they own from a receipt, a photo, or a note -
  that is a proposal. Archiving and deleting happen in the app.

### Telling you a fact about a thing - propose it, never save it

A **fact** about an Asset is review-gated even though the Asset itself is not. When the
user tells you something about a thing they own:

1. `search_assets` first, to find the thing they named.
2. `propose_asset_memories` with the `assetId` from that result and the fact itself -
   `{label: "Filter model", value: {type: "text", text: "EDR1RXD1"}}`. When the search
   found nothing to anchor to, pass `newAsset` instead and the Asset is proposed too.
3. Copy the value **character for character** from what they said. Never correct,
   expand, reformat, or complete a part number.

There is **no tool that saves an asset fact**, and you must not act as if there were.
Say it is waiting for review; if a later turn asks about it and you have no record, say
plainly that it is still waiting rather than inventing what you "saved" earlier.

Two things are *not* this path. A turn that is Global Capture belongs to
`capture_saved_item` - see the Global Capture rule in the base instructions, and do not
search or propose separately. And an explicit reminder the user asks for ("remind me to
change the filter every 6 months") is `create_general_action`; a dated or recurring
detail that merely *suggests* a reminder is `propose_asset_actions`. The `actions`
skill has both.

## Calendar

`list_calendar_events` reads the user's upcoming and recent events from the primary
connected calendar for a bounded window: title, time, who else is on it, location. It
answers "what's on my calendar?", "when am I meeting Sam?", "what did I have this
morning?".

It renders no card, so summarize what matters in your reply. This is provider-derived
context, **not** saved Tendnote memory: never present an event as an approved fact, and
never turn one into a reminder, memory, or draft without the user's explicit go-ahead.
You cannot create, move, update, delete, or RSVP to an event; if Calendar is not
connected or is temporarily unavailable, say so plainly instead of inventing events.

## Saved Items

`list_saved_items` browses the notes, links, and open questions the user parked for
later, plus the household ones shared with them, most recently touched first: "what did
I save?", "what's on my list?", "what questions did I settle?". Choose a status -
active (default), archived, resolved, or all.

It is a recency browse, not a search; to find one specific saved thing by its wording,
use `search_global_recall`. Each item's `excerpt` may be cut off, so never present one
as the user's complete note. Reading changes nothing: archiving, resolving, or
promoting a Saved Item happens in the app, so offer that rather than claiming to have
done it. Saving something new is `capture_saved_item`.
