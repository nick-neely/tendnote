# Tendnote

Tendnote is a personal relationship memory and follow-up assistant. Its language should preserve a private, consent-first relationship notebook model rather than a sales CRM model.

## Language

**Observation**:
Agent-inferred, low-trust relationship context that is reviewable and disposable. An observation can be used to ask whether something should be saved, but it is not durable truth.
_Avoid_: Automatic memory, inferred fact

**Memory**:
User-approved or strongly user-confirmed durable relationship context about a person. A memory can be used later for recall, follow-up suggestions, and message drafting according to its sensitivity and scope.
_Avoid_: Observation, raw note, profile fact

**Source Record**:
The canonical evidence record for logged context, such as a manual note, interaction summary, import preview, calendar event summary, or future email summary. Source records can ground suggestions when phrased as "you noted", "you logged", or "you mentioned", but they are not the same as durable memories.
_Avoid_: Memory, confirmed fact, inferred fact

**Retained Content**:
The minimized source record text Tendnote keeps for retrieval, grounding, and review. Retained content should be enough to explain the context without preserving unnecessary raw provider data.
_Avoid_: Raw dump, full transcript

**Pending Source Record**:
A source record captured before Tendnote has resolved the person or decided whether the record should be retained. Pending source records can appear in review, but should not feed normal profiles, briefs, or drafts until resolved.
_Avoid_: Orphan memory, unresolved fact

**Personless Source Record**:
A temporary pending source record with no linked person yet, such as a quick note about someone not worth a profile until the user decides. Personless source records should be reviewed, linked, converted into a new person, or archived.
_Avoid_: General note, memory, profile

**Logged Context**:
A user-entered or imported source record that records what the user said happened or what an approved source provided. Logged context can ground suggestions when phrased as "you noted", "you logged", or "you mentioned", but it is not the same as a durable memory.
_Avoid_: Memory, confirmed fact, inferred fact

**Interaction**:
A type of source record for human contact, such as a lunch, call, meeting, hangout, or message thread summary tied to a person. In Phase 1, interactions should not require a separate table unless they gain behavior that `source_records` cannot represent.
_Avoid_: Separate notes bucket, memory, task

**Suggested Memory**:
An observation presented to the user for save, edit, or dismiss review before it becomes a memory.
_Avoid_: Auto-saved memory, silent extraction

**Context Snapshot**:
A rebuildable generated profile card for a person that helps Tendnote load relationship context quickly. A context snapshot is not a source of truth and must point back to supporting people, memories, source records, and follow-ups.
_Avoid_: Profile fact, memory store, generated truth

**Exact Recall**:
Finding specific stored relationship context by names, places, companies, phrases, or other explicit text in canonical records. Exact recall is distinct from fuzzy semantic retrieval and proactive relationship suggestions.
_Avoid_: Semantic search, recommendation, generated summary

**Semantic Retrieval**:
Finding stored relationship context by meaning or theme when the user does not know the exact words, such as gift ideas, career updates, or stressful life events. Semantic retrieval can surface grounded context, but it is not the same as proactive relationship agenda ranking.
_Avoid_: Exact recall, recommendation engine, daily brief

**Relationship Agenda**:
A read-only, cross-person view of existing upcoming or review-worthy relationship context for a time window. A relationship agenda can help Eve answer broad questions, but it is not a suggestion generator, follow-up creator, or persisted brief.
_Avoid_: Generated task list, background scanner, daily brief

**Follow-Up**:
A user-visible reminder to reconnect with a person for a specific reason at a specific time or cadence.
_Avoid_: Task, deal, lead activity

**Suggested Follow-Up**:
An agent-proposed follow-up that the user can accept, dismiss, or ignore before it becomes a normal reminder. Suggested follow-ups may appear as review prompts or low-weight brief items, but they are not the same as user-created follow-ups.
_Avoid_: Automatic task, open reminder

**Review Queue**:
A lightweight place to find unresolved source records, suggested memories, and suggested follow-ups. The review queue is an entry point, not the main product metaphor.
_Avoid_: Task inbox, pipeline, work queue

**Assistant Surface**:
The conversational Tendnote interface where the assistant can respond with natural language and structured components for reviewing memories, source records, follow-ups, briefs, or drafts.
_Avoid_: Raw chatbot, task manager

**Daily Brief**:
A small set of relationship suggestions for today. It should stay capped and useful rather than becoming a task feed.
_Avoid_: Pipeline, queue, inbox

**Weekly Relationship Review**:
A broader periodic brief for stale contacts, overdue follow-ups, missed birthdays, and lower-priority relationship context. It uses the same persisted brief-item model as the daily brief rather than a separate queue.
_Avoid_: Task feed, backlog, separate review system

**Message Draft**:
A private, Tendnote-owned draft of a message to a person, grounded in relationship context and persisted with the source references that informed it. Drafts stay inside Tendnote — the user reviews, edits, copies, dismisses, approves internally, or marks them sent manually — and approving is internal readiness only, never an external send or draft.
_Avoid_: Outbox, campaign, automatic send, external draft

**Private Beta Access**:
The account-level gate that decides whether a signed-up user may enter Tendnote during the early hosted product phase. It controls product access only; it is not the same as relationship data ownership, integration authorization, or payment status.
_Avoid_: Public signup, environment allowlist, owner scope
