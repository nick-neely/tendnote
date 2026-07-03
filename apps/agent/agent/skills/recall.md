---
description: Use when the user wants to find, recall, or look up a person, note, memory, or relationship context — by exact name/text or by meaning — or asks a broad horizon question like "anything coming up next week?", "who deserves a thought today?", "what should I review?", or "any follow-ups due soon?".
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
