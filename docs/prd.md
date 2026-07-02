# Tendnote PRD

**Status:** Draft 0.1  
**Date:** 2026-06-24  
**Project:** Tendnote  
**Owner:** Nick Neely  
**Purpose:** Handoff-ready PRD for creating vertical-slice issues in Codex or another fresh coding agent.
**Locked technical decisions:** Postgres on Neon, Drizzle ORM, Better Auth, and AI Elements for AI-native UI components.

---

## 1. Executive Summary

### Problem Statement

People forget to follow up, miss small but meaningful context, and lose track of birthdays, thank-you notes, networking follow-ups, gift ideas, and personal relationship history. Existing CRMs are usually sales-oriented or too manual for personal life.

### Proposed Solution

Tendnote is a personal relationship assistant built on Eve, Vercel's agent framework. It stores structured relationship context, suggests timely follow-ups, drafts messages, and produces lightweight daily or weekly relationship briefs while requiring explicit approval before any outbound action.

### Product Angle

Tendnote is not a sales CRM and should not feel like one. It is a relationship memory and follow-up layer for personal life, friends, family, professional networking, and eventually shared household context.

The product should feel closer to:

- A private relationship notebook
- A reminder system for people
- A drafting assistant for thoughtful follow-ups
- A lightweight agent that helps maintain relationships without turning them into tasks

It should avoid:

- Generic AI branding
- Sales pipeline language
- Autonomous outreach without approval
- Overly sentimental or fake-sounding message drafts
- Creepy surveillance-style memory extraction


### Branding and Naming Conventions

Use consistent casing across product, code, infrastructure, and docs.

| Context | Convention |
|---|---|
| Product and brand copy | Tendnote |
| Repository name | `tendnote` |
| Folder and workspace names | lowercase, for example `apps/web`, `apps/agent`, `packages/db` |
| Domain | `tendnote.com` |
| Vercel project names | `tendnote-web`, `tendnote-agent`, or equivalent lowercase names |
| Package scope | `@tendnote/*` |
| Internal packages | `@tendnote/db`, `@tendnote/domain`, `@tendnote/config`, later `@tendnote/integrations` |
| Database name | `tendnote` |
| Environment variable prefix | `TENDNOTE_` |
| UI logo text | Tendnote |

Avoid `TendNote`, `TendNoteAI`, `PersonalAgent`, or other artificial casing. Human-facing copy should use `Tendnote`; code, packages, domains, and infrastructure should use `tendnote`.

### Success Criteria

Initial success should be measured with practical, personal-use metrics:

- A user can capture a person, note, birthday, or follow-up in under 30 seconds.
- Daily brief produces no more than 3 suggested actions by default.
- 90% or more of follow-up suggestions are marked useful, accepted, or not annoying during manual review.
- 100% of outbound messages require explicit approval before sending or draft creation.
- AI evals catch invented memory, unsafe sharing, and send-without-approval behavior before release.
- The app is useful with manual data entry before Gmail, Calendar, or Contacts integrations exist.

---

## 2. User Experience and Functionality

### User Personas

#### Primary Persona: Nick

A software consultant who wants a private tool to remember relationship context, follow up with people, keep track of birthdays, draft natural messages, and eventually experiment with a real Eve-powered agent architecture.

#### Future Persona: Shared Household User

Nick and Mara use Tendnote for shared social context, family events, gift ideas, household reminders, and shared contacts while keeping private notes scoped to the correct person.

#### Future Persona: Developer / Self-Hoster

A technical user who wants to fork or deploy a personal relationship agent template with their own data, integrations, and storage.

### Core User Flows

#### Flow 1: Capture a Memory

1. User opens Tendnote or messages the agent.
2. User enters: "Remember that Caleb is job hunting and likes backend work."
3. Agent resolves or asks which Caleb if ambiguous.
4. Agent stores a structured memory with source, timestamp, confidence, and sensitivity level.
5. User can later ask: "What do I know about Caleb's job search?"

#### Flow 2: Create a Follow-Up

1. User says: "Remind me to check in with Austin next Friday about his interview."
2. Agent creates a follow-up tied to Austin.
3. The follow-up appears in the daily or weekly brief when due.
4. User can dismiss, snooze, complete, or request a draft.

#### Flow 3: Daily Brief

1. Eve schedule runs every morning.
2. Agent reviews due follow-ups, birthdays, stale contacts, and upcoming events.
3. Agent generates 1 to 3 suggested actions.
4. User can accept, dismiss, snooze, or ask the agent to draft a message.

#### Flow 4: Draft a Message

1. User asks: "Draft a casual birthday text for Jake."
2. Agent pulls relevant profile and memory context.
3. Agent drafts a concise message in Nick's tone.
4. User edits, copies, approves draft creation, or dismisses it.
5. Agent never sends directly in the MVP.

#### Flow 5: Calendar-Based Follow-Up, Later Phase

1. Google Calendar connection is enabled.
2. Agent detects a meeting, dinner, call, or coffee chat.
3. After the event, agent suggests a thank-you or follow-up.
4. User approves before a draft is created.

### User Stories and Acceptance Criteria

#### Story 1: Add a Person

As a user, I want to add a person with basic relationship details so that Tendnote can track context about them.

Acceptance criteria:

- User can add display name, relationship type, birthday, notes, and contact methods.
- Person can be created from UI and from natural language agent input.
- Duplicate names trigger a clarification rather than silently creating or merging records.
- Created person appears in search and profile views.

#### Story 2: Store a Memory

As a user, I want to store small facts about people so that I can recall them later.

Acceptance criteria:

- User can add a memory manually or through the agent.
- Memory includes person, content, source, sensitivity, confidence, and timestamp.
- Agent does not invent missing facts.
- User can edit or delete a memory.
- Sensitive memories are not included in shared context by default.

#### Story 3: Create and Manage Follow-Ups

As a user, I want to create follow-up reminders tied to people so that I do not forget important check-ins.

Acceptance criteria:

- Follow-up supports due date, person, reason, status, and optional cadence.
- User can complete, snooze, dismiss, or edit a follow-up.
- Due follow-ups appear in the daily brief.
- The agent briefly explains why a follow-up was suggested.

#### Story 4: Generate Daily Brief

As a user, I want a small daily brief so that I know who to think about today without feeling nagged.

Acceptance criteria:

- Daily brief defaults to 1 to 3 suggested actions.
- Brief can include due follow-ups, birthdays, upcoming events, and stale-contact suggestions.
- Brief does not include sensitive private notes unless directly relevant and authorized.
- User can dismiss or snooze each item.

#### Story 5: Draft a Message

As a user, I want Tendnote to draft follow-up, birthday, thank-you, and networking messages so that I can respond thoughtfully without starting from zero.

Acceptance criteria:

- Draft uses stored context when available.
- Draft does not claim facts that are not stored or supplied by the user.
- Draft is concise and casual by default.
- Draft can be regenerated with tone instructions.
- No message is sent without explicit user approval.

#### Story 6: Import Contacts, Later Phase

As a user, I want to import contacts so that I do not have to manually create every person.

Acceptance criteria:

- Google Contacts import can preview records before writing.
- Duplicate candidates are shown for review.
- Import does not overwrite manually created notes without confirmation.
- Imported records are tagged with source metadata.

#### Story 7: Shared Household Context, Later Phase

As a user, I want shared context with my partner so that we can remember family events, gifts, and social commitments together.

Acceptance criteria:

- Notes and people can be scoped as `private`, `shared`, or `household`.
- Private notes are never shown to the other user.
- Shared reminders can be assigned to one or both users.
- Agent explains what context it used when drafting shared suggestions.

### Non-Goals

These are intentionally out of scope for the first usable version:

- Full sales CRM pipelines, deals, companies, revenue, or lead scoring
- Autonomous sending of texts, emails, or social messages
- LinkedIn scraping or brittle social media automation
- iMessage integration
- Native mobile app
- Multi-tenant SaaS billing
- Complex subagent trees before the core loop works
- Autonomous memory extraction from all email history
- Shared household context before private scope rules exist

---

## 3. AI System Requirements

### Eve Framework Fit

Tendnote should use Eve because the project maps cleanly to Eve's filesystem-first agent model:

- `agent/instructions.md` for the always-on relationship assistant prompt
- `agent/agent.ts` for model and runtime configuration
- `agent/tools/` for typed TypeScript tools that read/write people, memories, follow-ups, and drafts
- `agent/skills/` for reusable Markdown playbooks such as message drafting, privacy rules, and birthday handling
- `agent/channels/eve.ts` when the web chat bridge is active
- `agent/schedules/` only when daily briefs, birthday checks, stale-contact review, or weekly relationship review are implemented
- `agent/connections/` only when Google Contacts, Google Calendar, Gmail, Notion, or other integrations begin
- `agent/subagents/` only when specialized tasks such as memory curation, message drafting, or privacy review are implemented
- `agent/sandbox/` only when isolated import cleanup, CSV/vCard parsing, or one-off data workflows begin

Do not keep inactive future-phase placeholder files in the active Eve agent tree. Placeholders make the agent surface look more capable than it is and can confuse both Eve and implementation agents. Future schedules, channels, connections, subagents, and sandbox workflows should be added in the phase that actually enables them.

### Active Agent Directory Shape

```txt
agent/
  instructions.md
  agent.ts

  channels/
    eve.ts

  tools/
    search_people.ts
    get_person_context.ts
    create_person.ts
    capture_source_record.ts
    capture_memory.ts
    get_suggested_memory_review.ts
    approve_suggested_memory.ts
    dismiss_suggested_memory.ts

  skills/
    relationship-memory.md
    privacy-and-consent.md
```

Phase 1B.5 added `channels/eve.ts`, the real web chat bridge into the Eve agent. Later phases may add more tools, skills, schedules, connections, subagents, and sandbox workflows as their product behavior becomes real. Keep the active tree lean until then.

### Core Agent Instructions

The initial `instructions.md` should establish these rules:

```md
# Identity

You are Tendnote, Nick's private relationship memory and follow-up assistant.

# Purpose

Help Nick remember context about people, follow up at the right time, prepare for conversations, and draft thoughtful messages.

# Rules

- Prefer stored facts over guessing.
- Never invent personal facts, birthdays, relationships, or prior conversations.
- Clearly distinguish confirmed facts from suggestions.
- Never send an email, text, or message without explicit approval.
- Keep daily suggestions small and useful.
- Default to concise, casual, natural language.
- Respect private, shared, and household scopes.
- Ask a clarification when person identity is ambiguous.
- When storing a memory, include source, confidence, sensitivity, and timestamp.
```

### Tool Requirements

#### Phase 0 to Phase 1 Tools

| Tool | Purpose |
|---|---|
| `search_people` | Find people by name, tag, relationship type, or recency. |
| `get_person_context` | Load snapshot-backed trust-aware context for a person. |
| `create_person` | Create a person on explicit user intent (display-name first; no merge). |
| `capture_source_record` | Save logged context with source-record provenance. |
| `capture_memory` | Store an explicit approved memory tied to a person and source record. |
| `get_suggested_memory_review` | Load a persisted suggested memory for review. |
| `approve_suggested_memory` | Promote a suggested memory after explicit approval. |
| `dismiss_suggested_memory` | Reject a suggested memory after explicit dismissal. |

#### Later Phase Tools

| Tool | Phase | Purpose |
|---|---|---|
| `create_followup` | 1E | Create a due follow-up for a person after manual follow-ups exist. |
| `list_due_followups` | 1E | Return active or due follow-ups for today, this week, or a person. |
| `update_followup_status` | 1E | Complete, dismiss, snooze, reopen, or archive follow-ups after manual follow-ups exist. |
| `get_relationship_agenda` | 1E.25 | Read and rank existing cross-person upcoming context for general asks such as "anything coming up next week?" without creating follow-ups or requiring a known person first. |
| `draft_message` | 1G | Draft a Tendnote-only message without sending or creating an external draft. |
| `create_message_draft` | 1G | Persist draft text inside Tendnote only after drafting begins. |
| `import_contacts_preview` | 2 | Preview Google Contacts import before writing. |
| `dedupe_people_preview` | 2 | Suggest duplicate merges without applying them automatically. |
| `create_email_draft` | 2 | Create Gmail draft after explicit approval and integration authorization. |
| `read_calendar_events` | 2 | Read upcoming and recent calendar events after Calendar integration is authorized. |
| `post_meeting_followup_candidates` | 2 | Suggest follow-ups after relevant events. |
| `export_user_data` | 5 | Export personal data for portability. |
| `delete_user_data` | 5 | Delete scoped data with audit log. |

### Skills

| Skill | Purpose |
|---|---|
| `relationship-memory.md` | Defines what should and should not be stored as memory. |
| `privacy-and-consent.md` | Defines approval requirements and sensitive-data boundaries. |
| `followup-prioritization.md` | Later Phase 1 skill for due reminders, briefs, and review ranking. |
| `message-drafting-tone.md` | Later Phase 1 skill for Tendnote-only message drafting. |
| `birthday-protocol.md` | Later Phase 1 skill for birthday prompts after birthday behavior exists. |
| `networking-playbook.md` | Later Phase 1/2 skill for professional follow-ups after follow-up behavior exists. |
| `shared-household-context.md` | Later Phase 3 skill for Nick and Mara shared context after scope enforcement exists. |

### Schedules

| Schedule | Phase | Behavior |
|---|---|---|
| Daily brief | 1F | Runs every morning and suggests 1 to 3 relationship actions. |
| Weekly relationship review | 1F | Reviews stale contacts, overdue follow-ups, missed birthdays, and lower-priority context using the same persisted brief-item model as the daily brief. |
| Birthday check | 1F | Prompts user for upcoming or same-day birthdays using stored Tendnote data. |
| Stale contact check | 1F | Suggests people not contacted recently as reviewable brief items, using closeness and cadence. |
| Post-meeting follow-up | 2 | After calendar events, suggests thank-you or follow-up messages. |
| Monthly cleanup | 3 | Suggests duplicate cleanup, missing birthdays, and stale reminders. |

### Channels

Phase 1 should start with web chat only.

Recommended channel order:

1. Web chat inside the Tendnote app
2. Mobile-friendly PWA experience
3. Email digest for daily/weekly briefs
4. Slack or Telegram DM for quick capture
5. SMS/Twilio only if the product proves useful

### Subagents

Subagents are not required for the first usable version. Add them when the main agent becomes too broad or when permissions need to be narrower.

Future subagents:

| Subagent | Purpose |
|---|---|
| `memory-curator` | Converts messy notes into structured memories. |
| `message-drafter` | Drafts messages with limited read-only context. |
| `relationship-reviewer` | Scores follow-up suggestions and ranks brief items. |
| `privacy-guard` | Checks whether an output leaks private or shared-only context. |

### Sandbox Usage

Use the Eve sandbox for isolated, non-production operations:

- CSV and vCard contact import parsing
- Duplicate detection preview generation
- Data export file generation
- One-off cleanup scripts
- Local benchmark/eval fixture processing

The sandbox should not receive unrestricted production data. Send narrow, temporary datasets only.

### Evaluation Strategy

AI behavior should be tested with evals before adding integrations.

Required evals:

| Eval | Expected Outcome |
|---|---|
| `no-send-without-approval` | Agent never sends or creates external drafts without approval. |
| `no-fake-memory` | Agent refuses to invent birthdays, relationships, or past events. |
| `person-disambiguation` | Agent asks clarification when multiple people match. |
| `tone-match` | Drafts are concise, casual, and not fake-sentimental. |
| `privacy-boundary` | Private notes are not exposed in shared context. |
| `brief-size-limit` | Daily brief stays within default item limit. |
| `source-grounded-recall` | Memory answers are grounded in stored records. |

Initial pass target:

- 100% pass on approval gate evals
- 95% or more pass on no-fake-memory evals
- 85% or more pass on tone-match evals
- 90% or more pass on brief relevance evals after at least 30 manual examples exist

---

## 4. Technical Specifications

### Recommended Tech Stack

| Layer | Recommendation |
|---|---|
| Repository/package management | Turborepo with pnpm workspaces |
| App framework | Next.js App Router, TypeScript |
| UI | Tailwind CSS, shadcn/ui, AI Elements |
| Agent framework | Eve |
| Database | Postgres on Neon |
| ORM/query | Drizzle ORM and Drizzle Kit migrations |
| Auth | Better Auth |
| AI model routing | Vercel AI Gateway where practical |
| Background agent work | Postgres-owned jobs with Vercel Queues as the default production delivery path for lightweight event-driven processors; separate queue topics per processor family; local inline processing, Cron, manual runners, Eve schedules, or Vercel Workflows are used when the workflow shape requires them |
| Email | Resend for app/system emails, Gmail draft creation through approved Tendnote drafts |
| Testing | Vitest, Playwright |
| AI evals | Eve evals plus fixture-based regression tests |
| Deployment | Vercel |
| Observability | Vercel Observability, optional Sentry |

### Locked Implementation Decisions

These decisions are resolved and should not be treated as open questions during issue creation:

- **Database:** Use Neon-hosted Postgres for all production and preview environments.
- **ORM:** Use Drizzle ORM for schema definition, typed queries, and migrations via Drizzle Kit.
- **Auth:** Use Better Auth for authentication and session management. Better Auth-owned tables should live in the same Neon Postgres database unless implementation docs recommend a different layout.
- **UI foundation:** Use Tailwind CSS, shadcn/ui, and AI Elements. AI Elements should be used for agent/chat-facing surfaces such as conversation history, prompt input, message rendering, tool status, approval/confirmation UI, queue/task state, and future sources/reasoning display where appropriate.
- **Data ownership:** `packages/db` owns schema and migrations. `packages/domain` owns shared validation/domain types. `apps/web` and `apps/agent` consume both instead of duplicating business logic.

### Architecture Overview

```txt
User
  |
  | Web app / chat / future channel
  v
Next.js app
  |
  | authenticates via Better Auth
  v
Neon Postgres
  ^
  | read/write via Drizzle
  |
Application services
  ^
  | calls typed tools
  |
Eve agent
  ^
  | invokes
  |
Next.js app / Eve channels
  |
  | optional future integrations
  v
Google Contacts / Calendar / Gmail / Notion
```

### UI Component Strategy

Tendnote should use regular shadcn/ui components for app shell, forms, tables, cards, settings, and dashboard views. Use AI Elements for AI-native interaction surfaces rather than hand-rolling chat primitives.

Initial AI Elements usage should focus on:

- Conversation and message rendering for the Tendnote assistant panel
- Prompt input for quick capture and natural language actions
- Tool/status display for agent actions like searching people, creating follow-ups, and drafting messages
- Confirmation or approval UI before draft creation, external writes, or integration actions
- Queue/task-style UI for daily brief items and pending suggestions, if the component fit is clean

Do not over-customize AI Elements in the MVP. Install only the components needed for the first vertical slice, keep them local to `apps/web/components/ai-elements`, and allow styling to inherit from the shared shadcn/Tailwind theme.

### Repository Shape

Tendnote should start as a lean Turborepo. The project naturally has separate bounded areas: the Next.js product app, the Eve agent, shared database/schema logic, shared domain types, and later integrations. The monorepo should keep those areas separate while still allowing the app and agent to reuse the same typed domain and database logic.

#### Target MVP Turborepo Shape

```txt
tendnote/
  apps/
    web/
      app/
      components/
        ai-elements/
        ui/
      lib/
        auth/
      public/
      package.json

    agent/
      agent/
        instructions.md
        agent.ts
        tools/
        skills/
        schedules/
        channels/
        connections/
        subagents/
        sandbox/
      evals/
      package.json

  packages/
    db/
      schema.ts
      migrations/
      queries/
      seed.ts
      drizzle.config.ts
      package.json

    domain/
      people.ts
      memories.ts
      followups.ts
      drafts.ts
      privacy.ts
      package.json

    config/
      eslint/
      typescript/
      tailwind/
      package.json

  docs/
    prd.md
    architecture.md
    agent-notes.md
    security.md

  turbo.json
  package.json
  pnpm-workspace.yaml
```

#### Package Boundaries

| Workspace | Responsibility |
|---|---|
| `apps/web` | Next.js UI, routes, dashboard, people pages, follow-up views, draft review UI, settings, Better Auth routes/client setup, AI Elements chat components, and user-facing API routes. |
| `apps/agent` | Eve agent runtime, instructions, currently implemented tools/skills, and evals. Add schedules, channels, connections, subagents, and sandbox workflows only when the relevant phase has real behavior. |
| `packages/db` | Drizzle schema, Drizzle Kit migrations, seed data, query helpers, and Neon database client setup. |
| `packages/domain` | Shared TypeScript domain types, validation schemas, enums, and business rules for people, memories, follow-ups, drafts, and privacy scopes. |
| `packages/config` | Shared TypeScript, ESLint, Tailwind, and other repo-level configuration. |
| `packages/integrations` | Add later when Google Contacts, Calendar, Gmail, Notion, or other wrappers become large enough to extract. |

#### Import Direction Rules

- `apps/web` may import from `@tendnote/db`, `@tendnote/domain`, and `@tendnote/config`.
- `apps/agent` may import from `@tendnote/db`, `@tendnote/domain`, and `@tendnote/config`.
- `packages/db` may import from `@tendnote/domain` when it needs shared enums or validation types.
- `packages/domain` should not import from app workspaces, Eve runtime code, or database implementation code.
- `apps/web` and `apps/agent` should not reach into each other's internal files.
- Eve-specific code should stay isolated to `apps/agent` so the rest of the product is not tightly coupled to beta APIs.

#### Example Dependency Usage

```txt
apps/agent/agent/tools/create_followup.ts
  imports @tendnote/domain
  imports @tendnote/db

apps/web/app/followups/page.tsx
  imports @tendnote/domain
  imports @tendnote/db
```

This keeps the web app and agent aligned on the same data model without duplicating business logic.

#### Early Scope Discipline

Start with only these workspaces:

```txt
apps/web
apps/agent
packages/db
packages/domain
packages/config
```

Do not create extra packages for every domain area at the start. Add `packages/integrations` only when Phase 2 integrations begin.

### Data Model

Minimum schema for the MVP. Better Auth may generate or own the canonical auth/user/session/account tables depending on the selected adapter. Tendnote application tables should reference the authenticated user id and may use an app-level profile table if needed for product-specific fields.

### Memory Storage and Retrieval Strategy

Tendnote should store memory in Neon Postgres, not a separate vector database for the initial product. Postgres is the source of truth, Drizzle owns the schema/migrations, and retrieval should become more capable in small steps rather than starting with a complex RAG stack.

Use four layers:

1. **Source records**: raw-ish interaction summaries, notes, imports, calendar events, and future email summaries.
2. **Atomic memories**: small facts about a person, stored as `suggested` until user-approved or explicitly saved.
3. **Search indexes**: normal SQL indexes first, then Postgres full-text search, then pgvector embeddings for semantic lookup.
4. **Context snapshots**: precomputed person profile cards that let the agent load the right context quickly without dumping every memory into the model.

Recommended Phase 1 memory rollout:

| Slice | Storage/retrieval capability | Notes |
|---|---|---|
| Phase 1A | Plain Postgres + relational indexes | Store people, source records, memories, follow-ups, drafts, and audit events. Retrieve by `owner_user_id`, `person_id`, `status`, recency, and importance. |
| Phase 1B | Context snapshots | Add `person_context_snapshots` to cache generated profile cards after memory, source record, follow-up, and profile changes. |
| Phase 1C | Postgres full-text search | Add `tsvector`/GIN-backed search over memory content, source record content, interaction summaries, and person names. |
| Phase 1D | pgvector semantic retrieval | Add embedded relationship-context records for fuzzy queries like gift ideas, career updates, stressful life events, and later agenda candidate support. |
| Phase 1E.25 | Relationship agenda read model | Add a cross-person, owner-scoped agenda query over due follow-ups, birthdays, review items, recent context, and existing strong suggestion candidates so Eve can answer broad time-window questions before persisted briefs exist. |

Agent retrieval should be hybrid:

- Use deterministic SQL for known-person context, birthdays, due follow-ups, pinned memories, and recent source records.
- Use full-text search for exact recall like names, companies, places, or specific phrases.
- Use pgvector later for fuzzy or semantic recall over approved memories and selected logged context.
- Use the relationship agenda read model for broad horizon questions such as "anything coming up this week?", "who deserves a thought today?", or "what should I review?" without forcing a person-specific context load.
- Always apply hard filters first: `owner_user_id`, scope, sensitivity, memory status, and person/workspace access.
- Build a small context pack for the model, usually the profile snapshot plus the top 8-15 supporting memories/source records.

Do not add Redis or a standalone vector database in Phase 1 unless a measured bottleneck appears. Persisted context snapshots are the preferred first performance optimization.

```txt
users / auth_users
  id
  email
  display_name
  created_at
  updated_at

people
  id
  owner_user_id
  display_name
  first_name
  last_name
  birthday
  relationship_type
  closeness_level
  profile_note          # optional short blurb, not relationship history
  source
  created_at
  updated_at

contact_methods
  id
  person_id
  type                  # email, phone, social, other
  value
  is_primary
  source
  created_at
  updated_at

source_records
  id
  owner_user_id
  source_type           # manual_note, interaction_summary, contact_import, calendar, gmail, other
  status                # pending_resolution, active, dismissed, archived
  source_ref            # optional external/provider id
  occurred_at
  content               # retained/minimized note, summary, or imported context
  raw_content           # optional short-lived or dev-only raw input when needed
  retention_policy      # retain, summarize_then_delete, delete_after_processing
  confidence            # low, medium, high
  metadata_json         # display/debug/source-specific details, non-authoritative
  created_at
  updated_at

source_record_people
  source_record_id
  person_id
  role                  # primary, mentioned
  created_at

source_record_mentions
  id
  source_record_id
  mention_text
  status                # unresolved, linked, ignored
  linked_person_id
  candidate_person_ids
  created_at
  updated_at

memories
  id
  person_id
  owner_user_id
  memory_type           # preference, life_event, gift_idea, boundary, context, followup_context, other
  content               # atomic approved or suggested fact
  status                # suggested, approved, dismissed, archived
  source_record_id
  sensitivity           # normal, sensitive, restricted
  confidence            # low, medium, high
  importance            # 1-5
  scope                 # private, shared, household
  approved_at
  dismissed_at
  created_at
  updated_at

extraction_jobs
  id
  owner_user_id
  source_record_id
  status                # pending, running, completed, failed, skipped
  attempts
  last_error
  idempotency_key
  run_after
  claimed_at
  completed_at
  created_at
  updated_at

relationship_context_embedding_jobs # Phase 1D
  id
  owner_user_id
  record_kind
  record_id
  status                # pending, running, completed, failed, skipped
  attempts
  last_error
  idempotency_key
  run_after
  claimed_at
  completed_at
  created_at
  updated_at

relationship_context_embeddings # Phase 1D
  owner_user_id
  person_id
  record_kind
  record_id
  embedding
  embedding_model
  embedding_version
  embedded_text
  content_fingerprint
  trust_level
  sensitivity
  created_at
  updated_at
  unique_current_key   # owner_user_id, record_kind, record_id, embedding_model, embedding_version

person_context_snapshots # Phase 1B
  person_id
  owner_user_id
  summary
  pinned_memory_ids
  recent_source_record_ids
  stale_after
  generated_at

followups
  id
  person_id
  owner_user_id
  reason
  due_at
  status                # open, completed, snoozed, dismissed
  cadence
  last_prompted_at
  created_at
  updated_at

message_drafts
  id
  person_id
  owner_user_id
  channel               # text, email, slack, other
  purpose               # birthday, thank_you, check_in, networking, other
  body
  status                # draft, approved, dismissed, sent_manually
  created_at
  updated_at

audit_log
  id
  owner_user_id
  action
  entity_type
  entity_id
  metadata_json
  created_at
```

### Integration Points

#### Google Contacts, Phase 2

Use for contact import and birthday/contact method sync. Start with preview-only import before writing data.

#### Google Calendar, Phase 2

Use for upcoming events and post-meeting follow-up suggestions. Calendar data should not automatically become permanent memory without approval.

#### Gmail, Phase 2 or Later

Start with draft creation only. Reading Gmail should be carefully scoped and should require explicit user authorization. Avoid full autonomous email-history extraction until evals and privacy controls are mature.

#### Notion or Obsidian, Later

Optional import/export path for personal notes. Not required for MVP.

### Security and Privacy

Tendnote stores personal relationship data, which can be sensitive even when it is not legally regulated.

Requirements:

- No outbound send action without explicit approval.
- Private and shared scopes must be enforced in code, not only in prompts.
- Sensitive memories must be excluded from daily briefs unless directly requested.
- All tool calls that mutate data should write to `audit_log`.
- Contact import should use preview and approval before committing records.
- Secrets must stay in environment variables and never be committed.
- Better Auth secrets, trusted origins, OAuth credentials, and Neon connection strings must be environment-scoped.
- Personal seed data must not be committed to public repositories.
- User should be able to export and delete their data.
- If open sourced, include mock data only.

---

## 5. Risks and Roadmap

### Phased Rollout

#### Phase 0: Foundation

Goal: Set up the repo, app shell, database, and minimal Eve agent skeleton.

Deliverables:

- Turborepo scaffold with pnpm workspaces
- `apps/web` Next.js app shell
- `apps/agent` Eve agent workspace
- `packages/db` with Drizzle schema, Drizzle Kit migrations, and Neon client setup
- `packages/domain` with shared types and validation schemas
- `packages/config` with shared TypeScript, lint, and style config
- Better Auth wired into `apps/web` and backed by Neon Postgres
- AI Elements installed for the initial assistant/chat surface
- Basic Eve instructions file
- First tool: `search_people`
- First eval: `no-send-without-approval`
- Mock seed data

Vertical slice issue seeds:

- Scaffold Tendnote Turborepo with `apps/web`, `apps/agent`, `packages/db`, `packages/domain`, and `packages/config`.
- Scaffold Next.js app with TypeScript, Tailwind, shadcn/ui, and AI Elements inside `apps/web`.
- Add Drizzle schema, Drizzle Kit migrations, Neon client setup, and tables for people, memories, follow-ups, drafts, and audit log inside `packages/db`.
- Add shared domain types and validation schemas inside `packages/domain`.
- Initialize Eve agent directory with instructions, agent config, and first tool inside `apps/agent`.
- Build basic people list and person detail page.
- Add fixture-based eval for no outbound sending without approval.

#### Phase 1: Personal MVP

Goal: Make Tendnote useful without external integrations while building memory retrieval in incremental slices.

End state: Phase 1 should prove the full private Tendnote loop without external accounts or outbound actions:

- **Capture**: the user can add people, log source records, and save explicit memories through UI and Eve.
- **Curate**: suggested memories and reviewable records can be approved, edited, dismissed, or left pending. Review happens wherever the user already is, all through the same owner-scoped review mutations: the person ledger (full review — edit wording, sensitivity, archive), the dashboard's "Needs review" rail (a short cross-person list with inline approve/dismiss that hides when empty), and inline in chat (the tentative suggestion card carries approve/dismiss). The user can also just tell Eve to approve or dismiss. Every surface refers to a suggestion by the person's name and the record's content; raw record ids are never shown to the user.
- **Orient**: Eve and the web UI can load snapshot-backed context plus supporting records, exact search, and semantic retrieval.
- **Act**: the user can create and manage manual follow-ups through UI and Eve.
- **Brief**: Tendnote can generate small persisted daily and weekly briefs from reviewed context and due follow-ups.
- **Draft**: Tendnote can draft messages inside the app for review, copy, or dismissal, but cannot send externally.

Deliverables:

- Add/edit/search people
- Manual memory capture and agent-suggested observations
- Manual follow-up creation
- Daily brief schedule
- Weekly relationship review schedule
- Message drafting inside Tendnote
- Approval gate for all external actions
- Basic dashboard
- Plain Postgres retrieval first, then context snapshots, Eve-backed web chat, full-text search, pgvector, follow-ups, relationship agenda, briefs, and drafting as follow-on slices

##### Phase 1 Prep: Schema and Domain Alignment

- Align `packages/domain`, `packages/db`, migrations, query helpers, and seed data with the settled Phase 1 memory architecture before building new product surfaces.
- Replace CRM-leaning or ambiguous enum values, such as `relationship_type = client`, with personal-relationship language such as `professional`.
- Rename highest sensitivity from `private` to `restricted` so `private` only describes visibility scope.
- Remove hard unique display-name constraints and rely on disambiguation for duplicate names.
- Replace large freeform person notes with an optional short profile blurb; store notes and relationship history as source records.
- Add source records, source record people links, unresolved mentions, memory lifecycle fields, extraction jobs, and required source-record provenance for memories.
- Add deterministic policy tests for source-record provenance, pending-resolution behavior, lifecycle status rules, restricted-content retrieval, and duplicate-name disambiguation.

##### Phase 1A: Plain Postgres Memory

- Store people, source records, atomic memories, follow-ups, drafts, and audit events in Neon Postgres.
- Store extraction jobs in Postgres and process suggested-memory extraction asynchronously from source records.
- Keep extraction job state in Postgres. Local development may trigger processing inline after enqueue; production should publish a Vercel Queue message carrying the extraction job id to an extraction-specific topic and call the same shared processor. Source-record capture must not fail solely because queue publishing fails; the saved source record and pending extraction job remain recoverable. Cron or manual runners are recovery/backfill paths for pending jobs, not the normal production loop.
- Queue consumers process only the delivered job id. They must not opportunistically drain unrelated pending jobs; explicit recovery/backfill runners own bulk draining.
- Keep Postgres as the primary retry and recovery state. Queue retries cover transient delivery or consumer crashes, while the shared processor owns `pending`, `failed`, `skipped`, `completed`, `runAfter`, attempts, and audit metadata. Use Cron for cleanup, stale-job recovery, and backfill runners.
- Use one generic Cron-backed recovery dispatcher for cleanup and backfill across job families, with bounded processor-specific backfill functions for extraction, embeddings, and future Postgres-owned job families. The dispatcher must cap work per run and must not become the normal production processing loop.
- Keep Vercel Queue publishing at the deployed app/runtime edge. Shared packages own Postgres job enqueueing and processing; web or agent runtime code composes the Postgres job creation with queue message publication.
- Add a narrow outbox-style delivery intent for production queue delivery. When a Postgres-owned job is created, record the job kind, job id, queue topic, delivery status, attempts, and last publish error. The runtime edge publishes after commit and marks the intent delivered; recovery Cron republishes undelivered intents and can still run bounded processor-specific backfill as a backstop. Do not expand this into a generic domain event bus in Phase 1.
- Use one generic `background_job_deliveries` table for queue publish intents across extraction, embeddings, and future lightweight Postgres-owned processors. Keep product state in each processor's own job table. Delivery rows should include job kind, job id, topic, status, attempts, last error, next attempt time, created time, published time, and a uniqueness guard on job kind plus job id plus topic.
- Keep delivery status separate from processor job status. `background_job_deliveries.status` should use `pending`, `published`, `publish_failed`, and `abandoned`; it must not use `completed` or `failed` to describe extraction or embedding outcomes.
- Include `owner_user_id` on delivery intents when the underlying job is owner-scoped, but treat `background_job_deliveries` as operational infrastructure only. It must not become a user-facing object or relationship context source.
- Include the concrete `background_job_deliveries` schema in the queue foundation acceptance criteria: `id`, `owner_user_id`, `job_kind`, `job_id`, `topic`, `status`, `attempts`, `last_error`, `next_attempt_at`, `created_at`, `updated_at`, and `published_at`; `job_kind` as an enum starting with `extraction` and `embedding`; indexes for status plus next attempt time, owner plus status, and job kind plus job id; and a uniqueness guard on job kind plus job id plus topic.
- Store `topic` as the concrete queue topic string used at publish time, but route application code through a typed topic map keyed by `job_kind` so publishers, consumers, and tests cannot drift.
- Treat queue messages as pointers, not authority. Payloads should carry `deliveryId`, `jobKind`, and `jobId`; consumers must reload the delivery intent and processor job from Postgres before processing, validate that redundant payload fields match, and no-op safely on duplicate or stale messages through the shared processor's claim/idempotency behavior.
- Mark a delivery intent `published` as soon as Vercel accepts the queue `send()` call. Do not use delivery status to mean the message was consumed or the processor job completed.
- Queue consumers should not update delivery intents for every normal receive in Phase 1. They should update or log only delivery-level anomalies such as missing intents, mismatched payloads, obsolete deliveries, or invalid routing.
- Keep queue delivery visibility backend-only in the first implementation: schema state, structured logs, tests, and targeted recovery/inspection commands. Do not add a user-facing or broad admin UI for queue deliveries in Phase 1.
- Configure conservative per-topic rate/concurrency defaults for queue consumers from day one, with extraction and embedding consumers allowed to differ. Reserve a small rate-control boundary, such as `rateLimitKey` or `costCategory`, so Phase 2B's Redis-backed shared rate control can cover Eve ingress, expensive server actions, queue consumers, and future integration calls without refactoring the queue foundation. Treat provider throttling as retryable Postgres job state with backoff.
- Use Vercel's default deployment-partitioned push delivery for Phase 1 queue consumers. Do not design cross-deployment queue payload compatibility until an external producer or longer-retention workflow requires it.
- Treat the queue work as one standalone Background Job Delivery Foundation PRD, not separate extraction and embedding PRDs. The foundation PRD should include the shared delivery schema, Vercel Queue publisher/consumer layer, recovery Cron/backfill dispatcher, extraction as the first adopter, embeddings as the second adopter, and the reserved Phase 2B rate-control boundary.
- Sequence the Background Job Delivery Foundation PRD as dependency-ordered slices: delivery schema/domain foundation first; queue publisher/consumer runtime second; extraction adopter third; embedding adopter fourth; recovery and hardening fifth.
- Keep normal verification local and deterministic with fake queue adapters/messages covering delivery lifecycle, payload validation, duplicate or stale messages, publisher behavior, consumer behavior, and recovery/backfill. Live Vercel Queue smoke tests may exist behind explicit credentials for deployment validation, but ordinary local and CI verification must not require Vercel Queue access.
- Limit user-visible behavior to indirect outcomes: capture stays quick, suggested memories appear when extraction completes, semantic retrieval improves as embeddings finish, and failures remain recoverable without losing captured notes. Do not add a queue UI, queue dashboard, new review surface, or new Eve mode for this PRD.
- Add relational indexes for `owner_user_id`, `person_id`, `status`, recency, and importance.
- Treat explicit "remember/save/note" requests as durable memories.
- Treat inferred agent observations as `suggested` memories until approved, edited, or dismissed.

##### Phase 1B: Context Snapshots

- Add `person_context_snapshots` as generated profile cards for fast agent context loading.
- Regenerate snapshots after approved memory changes, source record additions, follow-up completions, and profile edits.
- Use snapshots as the first context layer, then fetch supporting memories/source records as needed.

##### Phase 1B.5: Eve-Backed Web Chat

- Replace the local-only web assistant capture path with a real web chat bridge into the Eve agent.
- Route web chat turns through Eve so the agent can search people, create people when the user explicitly intends it, capture source records, capture explicit memories, load snapshot-backed person context, and render persisted review components.
- Keep the active Eve tree lean: remove inactive future-phase placeholder schedules, channels, connections, subagents, and sandbox files until their phase has real code-level behavior.
- Preserve Phase 1 privacy and approval rules: no external sends, no external draft creation, no Gmail/Calendar/Contacts/shared-household behavior, and no automatic person creation from ambiguous casual mentions.
- Use this as the core natural-language loop before adding full-text search, semantic retrieval, briefs, drafting, or integrations.

##### Phase 1C: Full-Text Search

- Add Postgres full-text search over people, memory content, source record content, and interaction summaries stored as source records.
- Use full-text search for exact recall questions like companies, places, names, or specific phrases.
- Keep full-text search scoped by user, memory status, sensitivity, and visibility.

##### Phase 1D: pgvector Semantic Retrieval

- Add `relationship_context_embeddings` for approved memories and selected retained source-record summaries.
- Generate embeddings asynchronously through a Postgres-owned embedding job path that follows the extraction-job lifecycle pattern. Mutations enqueue or mark embedding work stale; capture, review, and profile reads must not wait on an embedding API call. Production should publish a Vercel Queue message carrying the embedding job id to an embedding-specific topic and call the same shared processor used by local inline, recovery, or backfill paths.
- Embedding queue consumers follow the same single-message, single-job rule as extraction consumers.
- Embedding retry behavior follows the same split: Postgres owns job state and Cron-backed recovery/backfill can drain pending work when queue delivery misses or is intentionally bypassed.
- Keep one current embedding row per owner, record, embedding model, and embedding version. Use `content_fingerprint`, `embedding_model`, and `embedding_version` to detect stale embeddings and update them in place.
- Store `embedded_text` as a deterministic, minimized projection of the source record or memory. Memories can embed approved memory content; source records should embed only retained/minimized fields such as interaction type, retained content, and resolved person display name when allowed.
- Put embedding generation behind a replaceable adapter. Persist `embedding_model`, `embedding_version`, and enough dimension/index metadata to validate query compatibility, but do not make the provider or model name part of the domain contract.
- Use pgvector for fuzzy retrieval, gift ideas, life-event themes, career updates, and context candidates that can later support "who should I check in with" style prompts.
- Rank Phase 1D semantic results primarily by vector similarity after hard policy filters. Allow only light deterministic tie-breakers such as recency or importance, and keep recommendation-style ranking for Phase 1E.25.
- Add an Eve `search_semantic_context` tool backed by a shared owner-scoped semantic retrieval query. Keep it separate from Exact Recall's `search_relationship_context`.
- Keep the Phase 1D product surface Eve-first. Add shared query/tool coverage and assistant result rendering as needed, but do not add a standalone semantic search page in this phase.
- Treat Phase 1D semantic matches as grounded context-finding, not proactive relationship agenda ranking. Phase 1E.25 owns "who should I check in with" prioritization.
- Let `search_semantic_context` fail open when embeddings are missing, stale, or still processing. Later agenda and brief behavior must remain useful without embeddings.
- Prove Phase 1D with deterministic fake-vector tests for policy filtering, enqueueing, staleness, ranking, and Eve tool behavior. Real provider smoke tests may exist behind explicit credentials, but normal verification must not call live embedding APIs.
- Do not block the initial usable MVP on embeddings. Add this after plain retrieval and snapshots work; it can proceed directly after Phase 1C, but later agenda and brief behavior should still work without embeddings.

##### Phase 1E: Follow-Up Lifecycle Through UI And Eve

- Add the follow-up lifecycle for person-linked reminders: create, complete, dismiss, snooze, reopen, archive, and edit.
- Add Eve tools for follow-up creation and status changes only after shared owner-scoped follow-up mutations and audit logging exist.
- Treat user-created follow-ups as active `open` reminders and agent-suggested follow-ups as `suggested` reviewable proposals. Do not let Eve silently turn suggestions into active reminders.
- Let Phase 1E include review-gated suggested follow-up creation and review when the suggestion is grounded in a source record, approved memory, retrieval result, or explicit user conversation context captured as a source record.
- Trigger suggested follow-up generation only from explicit user or Eve flows such as logging a note, reviewing a source record, approving a memory, viewing a person, or asking whether to follow up. Do not add a background scanner that periodically invents suggested follow-ups in Phase 1E.
- Require every saved follow-up, including suggested follow-ups, to have a concrete `dueAt`. Eve may propose dates from natural language, but must ask for clarification instead of creating vague "someday" reminders.
- Defer true recurrence. Keep `cadence` as inert metadata if needed, but do not auto-generate next follow-up instances when a follow-up is completed, snoozed, or edited in Phase 1E.
- Reuse the existing review surfaces for suggested follow-ups: person ledger, dashboard review rail, and Eve chat cards. Do not add a separate follow-up inbox in Phase 1E.
- Keep follow-ups personal and private in Phase 1; do not add Calendar-derived follow-ups or shared household reminders yet.
- Make due follow-ups visible on person profiles and the dashboard so the later brief has real action items to summarize.

##### Phase 1E.25: Relationship Agenda For General Asks

- Add a narrow cross-person agenda read model before persisted daily briefs so Eve can answer general time-window questions that are not tied to one known person.
- Support prompts like "anything coming up next week?", "who deserves a thought today?", "what should I review?", and "any follow-ups due soon?" without making the user name a person first.
- Sequence this after Phase 1E manual follow-ups and Phase 1D semantic retrieval so the agenda has both real active reminders and fuzzy relationship context to draw from. It should use semantic matches as part of the first 1E.25 slice, while still remaining useful when embeddings are missing, stale, or processing.
- Keep this as a shared owner-scoped query/API, not model-only reasoning, not a mutation surface, and not a persisted brief artifact yet. Phase 1F should persist selected agenda candidates as brief records and brief items.
- Introduce an Eve `get_relationship_agenda` tool with inputs for `windowStart`, `windowEnd`, optional `query`, `limit`, optional `includeKinds`, and `directlyRequested`. Eve may pass the user's broad ask or a short normalized phrase as `query` for semantic matching; if omitted, the agenda should still return deterministic items and recent context. The first `includeKinds` should cover `due_followup`, `birthday`, `review_item`, `recent_context`, `semantic_context`, and `suggested_followup`.
- Return one mixed deterministic ranked list of compact typed candidates with `kind`, `personId`, `personDisplayName`, `title`, `reason`, optional `dueAt`, `sourceRefs`, `trustLevel`, `sensitivity`, and `rank`. Do not return generated prose or grouped sections as the query contract; Eve responses or later brief UI may group items for presentation.
- Keep the Phase 1E.25 product surface Eve/tooling-first. Add the shared query, Eve tool, deterministic tests, and any minimal assistant tool-result rendering needed for stable chat output, but do not add a standalone agenda page or expand the dashboard into an agenda surface before Phase 1F persisted briefs.
- Keep `get_relationship_agenda` read-only. It may rank persisted follow-ups, birthdays, review items, recent eligible source records, and semantic retrieval matches, but it must not create follow-ups, create suggested follow-ups, update prompting metadata, run a background scanner, or persist brief artifacts.
- Keep hybrid composition inside the shared agenda read model. Eve should not stitch together separate `search_semantic_context` and follow-up/review queries for broad agenda answers; it should call `get_relationship_agenda`, and the shared query should apply owner scoping, policy filters, dedupe, and ranking across deterministic and semantic candidates.
- Use hybrid deterministic-plus-semantic ranking in the first implementation. Deterministic signals should still anchor the agenda: due or overdue open follow-ups, birthdays already stored in Tendnote, open review items, recent source records with clear dates, and high-confidence suggested follow-ups. Semantic matches should add useful fuzzy candidates from Phase 1D when available, but the agenda contract and core behavior must not depend on embeddings to return useful due-date, birthday, and review-item answers.
- Dedupe semantic matches against deterministic candidates when they point at the same source reference, person, or materially identical reason. The deterministic item should keep the primary `kind`, due/window semantics, and user-facing title, while the semantic match may add supporting `sourceRefs`, `reason` context, or a rank boost instead of becoming a duplicate agenda row.
- Treat birthday windows precisely for direct date-window asks: "anything next week?" should include only birthdays whose next occurrence falls inside `windowStart`/`windowEnd`. For broader prompts like "who deserves a thought today?", the agenda may use a small configurable prep buffer, defaulting to 7 days, and must label those items as upcoming rather than due.
- Include `recent_context` by default, but cap it and rank it below concrete agenda items. It should come only from active, person-linked, non-restricted source records with clear recency, so broad asks stay useful without turning the agenda into a noisy activity feed.
- Include both resolved review items and unresolved/personless source-record review items, but keep them distinct. Resolved suggested memories, suggested follow-ups, and source-record reviews may appear as person-linked agenda candidates; personless or unresolved source records should appear only as lower-priority `review_item` candidates with no `personId` and wording that asks the user to resolve the note rather than treating it as normal relationship context.
- Keep suggested memories and suggested follow-ups clearly tentative. Eve may surface them for review or as possible actions, but accepting a suggestion must call the appropriate review or follow-up mutation; it must not silently create active reminders. If the user wants a new reminder from an agenda answer, Eve should use the existing follow-up tools after that explicit intent rather than bundling creation into `get_relationship_agenda`.
- Exclude restricted content by default unless the user directly requests it. When `directlyRequested` is true, restricted matches may appear only as explicitly labeled restricted candidates with source grounding and intentional phrasing; they should not become quiet proactive birthday, follow-up, recent-context, or semantic fuel unless the current query clearly asks for that sensitive context. Personless pending source records may appear only as review items, not as normal agenda context.
- Add deterministic tests for owner scoping, date-window filtering, kind filters, ranking, sensitivity exclusion, tentative-vs-confirmed trust labels, semantic-match inclusion with fake vectors, embedding fail-open behavior, and Eve tool grounding. Normal verification should not require live embedding provider access.

##### Phase 1E.5: LLM Suggested-Memory Extraction

- Replace deterministic source-record-to-suggested-memory extraction with an LLM adapter after the review UI, lifecycle rules, source provenance, policy tests, and manual follow-up foundation are stable.
- Treat the LLM adapter as the production extraction path. Keep deterministic extraction available only as a replaceable test/local-fixture/fallback adapter, not as a silent production fallback that creates lower-quality suggestions when the model path fails.
- If the LLM adapter is unavailable or fails, use the existing `extraction_jobs` retry, failure, and audit lifecycle so model/provider problems are observable and recoverable.
- Keep the Postgres `extraction_jobs` lifecycle, idempotency key, audit log entries, sensitivity policy, person-resolution gates, and save/edit/dismiss review loop unchanged.
- Run LLM extraction once per eligible source record, passing retained source-record content plus the resolved people linked to that record. Do not run one model call per person link.
- The adapter should return zero or more atomic candidate memories, each tagged to a resolved `personId`; it must not create or infer new people, attach suggestions to unresolved mentions, or bypass the shared processor's per-person idempotency checks.
- Let the adapter propose `memoryType`, `importance`, `confidence`, and `sensitivity` for each candidate, but validate those values against existing enums/ranges and treat them as bounded classifications rather than policy authority.
- Apply hard source-record policy gates before model invocation, preserve manual/user sensitivity overrides, and choose the stricter sensitivity when model classification is more restrictive than the source record. The review UI remains the correction point before approval.
- The model should propose small atomic suggested memories from retained source-record content, not create approved memories, follow-ups, drafts, people, or external actions.
- Add extraction-quality fixture coverage before LLM extraction is allowed to feed daily briefs or message drafting as more than clearly tentative review hints.
- Cover messy relationship-note fixtures, including multi-person notes, no-memory notes, sensitive/restricted content, ambiguous people, over-specific claims, split atomic facts, and "do not infer" cases.
- Keep normal verification on fake or deterministic adapters for schema parsing, policy gates, idempotency, retry/failure behavior, and fixture regression. Any live-model evals must be explicit and credential-gated.
- Persist extraction provenance in audit or job metadata only, not as first-class memory fields. Capture adapter kind, extraction model, prompt/schema version, candidate count, and rejected/invalid candidate count where useful for debugging and evals.
- If job-level provenance is needed, add `metadata_json` to `extraction_jobs`; otherwise write richer `audit_log.metadata_json` for `memory.suggest`, `extraction_job.completed`, and `extraction_job.failed`. Do not add `model_version` or similar columns to `memories` in Phase 1E.5.
- Do not add a new user-facing review surface for LLM extraction. Phase 1E.5 should improve the existing suggested-memory pipeline and continue using the person ledger, dashboard review rail, and Eve chat cards for review.
- The only user-visible change should be better suggested-memory candidate quality and metadata already supported by the existing review UI, not a new extraction inbox, page, or assistant mode.

##### Phase 1F: Persisted Briefs

- Generate persisted brief records with stable child items, source references, statuses, and dismiss/snooze behavior.
- Use one shared brief model for daily and weekly cadences; vary date window, item cap, and ranking depth instead of creating separate daily-brief and weekly-review storage or lifecycle paths.
- Make generation idempotent per owner, local date, and cadence; scheduled retries and duplicate invocations should return the existing brief unless the user explicitly regenerates it.
- Store generation metadata on the brief record, including generated time, generation reason (`scheduled`, `manual`, or `regenerated`), agenda window start/end, and enough optional summary provenance to debug the decorative LLM summary without making model provenance part of item truth.
- Give brief items their own lifecycle statuses, such as active, dismissed, snoozed, and acted-on, so clearing a brief item does not mutate the underlying source record, memory, or follow-up unless the user explicitly takes that source action.
- Treat prior brief-item feedback as generation input. Regeneration should avoid reintroducing dismissed or currently snoozed items with the same source refs, person, and kind unless the snooze has expired or the user explicitly asks to ignore prior feedback.
- Snapshot the selected agenda candidate fields into each brief item at generation time, including kind, person, title, reason, due date, source references, trust level, sensitivity, and rank. Keep source references for grounding, but do not recompute user-facing title, reason, or rank from the live agenda query when rendering an existing brief.
- Treat scheduled brief generation as proactive context use: exclude restricted content, allow sensitive content only with source grounding and careful phrasing, and persist sensitivity on each brief item for rendering and action policy.
- Select brief items deterministically from the shared relationship agenda and source-backed signals. Phase 1F may include an LLM-generated summary line as presentation decoration, but the model must not choose items, change ranks, create actions, or become the source of truth for the brief.
- Store any generated summary line on the persisted brief record as nullable presentation text. If summary generation fails, create the brief with deterministic items and no summary rather than blocking the brief.
- Keep the first daily brief small: default to 1 to 3 items from due follow-ups, birthdays already stored in Tendnote, reviewed memories, recent source records, and retrieval signals.
- Surface persisted briefs first in the existing dashboard rail/current home experience. Do not require a separate brief history page for the first Phase 1F implementation.
- Persist and query prior briefs internally for feedback suppression, audit, and future history even though the first UI focuses on the current daily and weekly briefs.
- Use the Phase 1 retrieval stack in order: relational context, snapshots, full-text search, and semantic retrieval when available.
- Add Eve schedules only when brief generation is real. Use root-level Eve schedule files under `agent/schedules/` and account for Eve's UTC, at-least-once cron behavior with Tendnote-owned idempotency and leases.
- For per-user local-time daily and weekly briefs, prefer one static Eve dispatcher schedule that claims due Tendnote-owned schedule rows over hard-coded per-user cron files. Store recurrence, timezone, next run, lease, and retry state in Tendnote's app data.
- Default daily and weekly in-app brief generation on for the private Phase 1 owner, with stored schedule rows that can later be disabled. External email, push, calendar, or chat delivery remains out of scope until a later explicit opt-in phase.
- Have the dispatcher call the shared owner-scoped brief generator directly for normal persisted in-app briefs. Do not start an Eve `receive(...)` chat/session for each due brief unless a later notification surface needs proactive channel delivery.
- Add a narrow manual generate/regenerate action for the current daily or weekly brief so local testing and recovery do not depend on production cron. It must call the same shared generator; regeneration should be explicit and auditable rather than silently overwriting an existing brief.
- Keep suggested follow-ups reviewable. A brief may propose an action, but accepting it should create or update the underlying follow-up record.
- When a brief item represents a suggested follow-up, accepting it should use the existing owner-scoped suggested-followup review mutation and then mark the brief item acted-on. Do not create a brief-specific follow-up acceptance lifecycle.
- Include weekly relationship review in Phase 1F as the same persisted brief artifact with a broader window and ranking depth, not a parallel review artifact or later phase.
- Verify the product seam before UI expansion: tests should cover owner scoping, local-date/cadence uniqueness, duplicate schedule ticks, schedule lease/retry behavior, restricted-content exclusion, sensitive item preservation, item lifecycle transitions, explicit regeneration, and feedback suppression for dismissed or snoozed items.

##### Phase 1G: Tendnote-Only Message Drafting

- Add message drafting inside Tendnote after the capture, review, retrieval, follow-up, and brief loop is working.
- Drafts should use approved memories as facts, source records as source-grounded context, and suggested memories only as clearly tentative hints.
- Persist source references for each generated draft so the draft can explain which approved memories, source records, suggested memories, follow-ups, or brief items informed it. Do not rely on prompt-only grounding.
- Add `draft_message` and `create_message_draft` only for Tendnote-owned draft records. Do not create Gmail drafts, send messages, or write to external systems in Phase 1.
- Every draft should be reviewable, editable, dismissible, and source-grounded. The user remains responsible for copying or sending outside Tendnote.
- Add tone, no-fake-memory, source-grounded-drafting, and no-send-without-approval eval coverage before treating drafting as complete.

#### Phase 2: Hosted Account And Integration Foundation

Goal: Move Tendnote from a private local-owner app into a real authenticated hosted product, then add safe, preview-first integrations behind that account foundation.

Deliverables:

- Real Better Auth sign-up, sign-in, sign-out, protected app shell, and account/profile surface
- Support email/password, password reset, and GitHub sign-in for Phase 2A; defer Google sign-in and feature-specific integration OAuth linking
- Private beta access gate: first successful signup becomes the initial allowed owner; later signups require Vercel Flags targeting through user entities and beta segments
- Unapproved signups should still create Better Auth users, then land on a pending-access page until Private Beta Access is granted
- Pending-access users should see only a limited identity/access-status/sign-out area, not the normal app shell, relationship data, or Eve chat
- Persist product access in a Tendnote-owned account/profile row instead of deriving access from the oldest Better Auth user
- Keep the Phase 2A account page focused on identity, access status, and sign-out; add Phase 2B provider connection status as a reusable account-page section, and defer active-session management plus a separate settings/integrations route until live integrations need it
- Production and preview auth boundary that removes hosted reliance on `demo-user` while preserving an explicit local-development-only fallback
- Modular integration settings foundation for future provider connection status, authorization state, and revocation controls; prefer Better Auth-supported SSO/social providers for future sign-in/account-linking flows rather than making generic OAuth/OIDC the default abstraction
- Add reusable Tendnote-owned Redis-backed product rate limiting for Eve ingress, expensive server actions, queue consumers, and future provider calls, separate from Better Auth's auth/session rate limits and reusing the existing Redis connection
- Google Calendar read integration with birthday, upcoming event, and post-meeting follow-up prompts
- Gmail draft creation after explicit approval and user-scoped integration authorization
- Google Contacts import and duplicate-detection preview

Vertical slice issue seeds:

##### Phase 2A: Hosted Account Foundation

Complete Better Auth user flows, password reset, GitHub sign-in, private beta access, pending-access state, Vercel Flags discovery/evaluation, narrow account/profile page, protected route behavior, and signed-in Eve owner scoping.

##### Phase 2B: Provider Connections And Rate Limits

Add modular integration settings foundation with provider connection status rows, inert authorization affordances, revocation/audit placeholders for persisted state changes only, no token storage, and reusable Tendnote-owned Redis-backed product rate limiting before any external OAuth scopes are requested or provider data is read.

##### Phase 2C: Google Calendar Read Integration (PRD #105)

Add Google sign-in/account linking as needed through Better Auth's Google social provider and `linkSocial` flow, Google Calendar event-read connection, upcoming/recent event previews, and post-meeting follow-up candidates.

- **Authorization model**: Provider Connections remain the product consent/status/audit read model while Better Auth owns OAuth token custody (ADR 0071).
- **Read scope**: Calendar reads should be useful enough for event previews and follow-up candidates, not freebusy-only, while retaining minimized summaries/source records instead of raw provider payload dumps (ADR 0072).
- **Approval boundary**: A connected Calendar should be available as scoped read-through context for Eve and product surfaces without making the user approve every event; approval/review applies when Calendar context is promoted into durable memory, retained source records, active follow-ups, drafts, or external actions (ADR 0073).
- **Eve tool**: Eve may use a narrow live Calendar read tool that returns minimized summaries for bounded windows and performs no writes by itself (ADR 0074).
- **Cache model**: Calendar reads should use a short-lived minimized cache that supports Eve, the existing app-owned brief dispatcher, and later scheduled workflows without becoming a full provider sync database or durable memory store (ADR 0075).
- **Calendar selection**: Start with the primary calendar by default while carrying `calendarId` through provider/cache/tool seams from day one (ADR 0076).
- **Follow-up candidates**: Calendar-derived follow-up candidates should be proactive, capped, deduped, and reviewable rather than only appearing after explicit user prompts or silently becoming active tasks (ADR 0077).
- **Attendee matching**: Calendar attendees should match existing people by stable signals where possible, surface unresolved attendees when needed, and never auto-create people from Calendar data in Phase 2C (ADR 0078).
- **Retrieval boundary**: Cached Calendar events should not enter durable exact/semantic retrieval unless promoted into retained Tendnote state such as a source record or accepted follow-up (ADR 0079).
- **Disconnect**: Calendar disconnect should revoke/unlink provider access where supported, clear Calendar cache, update/audit Provider Connection state, and block further Calendar reads until reconnect (ADR 0080).
- **Failure behavior**: Calendar failures should degrade gracefully, use fresh-enough cache when appropriate, reserve durable Provider Connection `error` state for auth/config/persistent failures, and avoid token/raw-payload leakage (ADR 0081).
- **Classification**: Calendar-derived follow-up relevance should be deterministic-first with optional LLM classification over bounded minimized candidates, never raw payloads or unbounded history (ADR 0082).
- **Drafting handoff**: Phase 2C should create suggested follow-up actions and concise reasons, not full message drafts; Tendnote-only drafting remains the handoff path after the user chooses to act, and Gmail draft creation remains Phase 2D.
- **Product surface**: Treat assistant chat as the first-class Calendar experience, adapt existing calendar/brief widgets to show bounded upcoming/recent event highlights where useful, and add a small account/integration preview for connection health and verification without creating a separate integrations route.
- **Prompt nudges**: Consider AI Elements' `Suggestion` component as a lightweight prompt-nudge surface for Calendar-derived and normal follow-up/recommendation prompts, such as "Follow up after Tuesday's coffee with Maya"; these suggestions should send text to Eve rather than replace persisted review cards or accept/dismiss workflows.
- **Scope control**: Define the prompt-nudge shape generically enough for future follow-ups, briefs, recommendations, and relationship context, but populate it only from Calendar-derived nudges in Phase 2C so it does not become a broad recommendations system prematurely.
- **Human setup**: Include a `ready-for-human` Google OAuth setup slice with clear steps for consent screen, callback URLs, scopes, local/production env vars, and verification because Google Cloud configuration cannot be completed by code alone.

##### Phase 2D: Gmail Draft Creation (PRD #119)

Add Gmail draft creation and update behind explicit approval; do not read Gmail history or send messages.

- **Draft source of truth**: Gmail drafts externalize approved, source-grounded Tendnote message drafts rather than creating a parallel Gmail-native drafting path (ADR 0083).
- **External action records**: Persist minimized external draft action records for create/update idempotency, visible retry, provider draft ids, subjects, confirmed recipients, and non-secret errors (ADRs 0084, 0094).
- **Recipients**: Allow recipient addresses from saved contact methods or explicit user input, but do not silently save action-specific External Draft Recipients as person contact methods (ADR 0085).
- **Approval edits**: Approval-flow edits write through the Tendnote draft before Gmail is touched (ADR 0086).
- **Subjects**: Gmail drafts require approved subjects (ADR 0087).
- **Updates**: Linked Gmail drafts may be updated only with current user intent (ADR 0088).
- **Mailbox boundary**: Gmail state is not reconciled from mailbox reads in Phase 2D (ADR 0089).
- **Authorization model**: Reuse Better Auth Google token custody with separate incremental `google/gmail` Provider Connection consent from Calendar (ADR 0090).
- **Failure behavior**: Failures require visible retry rather than background automatic retry (ADR 0091).
- **Eve approval gate**: Eve writes use the shared approval gate (ADR 0092).
- **Calendar handoff**: Calendar-derived follow-ups enter Gmail only through reviewed follow-ups and Tendnote drafts (ADR 0093).
- **First-slice surface**: The first slice supports only `to`, subject, and body with inline draft state and policy-first verification (ADRs 0095, 0096, 0097).

##### Phase 2E: Google Contacts Import Preview (PRD #127)

Add Google Contacts import preview and duplicate candidate matching with manual confirmation.

- **Preview-confirm model**: Contacts import may create people or update existing people only through explicit preview confirmation; it should feel like confirming useful suggestions, not processing every provider row (ADRs 0098, 0104).
- **Retention boundary**: Unconfirmed preview rows are ephemeral or short-lived import-session state, not durable source records, memories, people, or contact methods (ADR 0099).
- **Conflict handling**: Confirmed candidates may add missing fields, but conflicting Tendnote profile/contact values require explicit resolution and must not be silently overwritten (ADR 0100).
- **Explicit import action**: Phase 2E uses a user-triggered "preview latest contacts" flow, not background sync, polling, webhooks, or automatic refresh, while keeping provider fetch/match/apply seams reusable for later sync (ADR 0101).
- **Field scope**: First slice imports display names, email addresses, phone numbers, and birthdays only; richer People API fields stay out of scope (ADRs 0102, 0117).
- **Matching**: Use deterministic email/phone matching plus advisory LLM or semantic fuzzy ranking; fuzzy matches require user confirmation before linking or updating a person (ADR 0103).
- **UI shape**: Google Contacts connection starts from the account/settings provider row, then opens a dedicated import preview surface with search, ranking, conflict handling, safe bulk confirmation, and post-confirmation feedback (ADRs 0105, 0111, 0112).
- **Data ownership**: Confirmed imports enrich profile/contact data only; they do not infer memories, follow-ups, semantic context, Gmail drafts, or outbound actions, and confirmed data remains in Tendnote after disconnect (ADRs 0106, 0118, 0119, 0121).
- **Provider/account boundary**: Contacts is a separate incremental Google capability on the same linked Google identity, limited to personal contacts and narrow People API scope (ADRs 0107, 0110).
- **Audit and recovery**: Record per-confirmed-candidate audit/provenance with minimized provider references, no raw provider payloads, no transactional undo in the first slice, and owner-wide contact-method dedupe (ADRs 0108, 0109, 0113, 0114).
- **Contact method shape**: Add normalized/display representations for contact methods, including phone normalization for matching, before import relies on owner-wide dedupe (ADRs 0115, 0116).
- **Verification**: Use fake adapters and fixture-based CI tests plus a manual live-Google smoke checklist; do not run live Google API tests in normal CI (ADR 0120).

##### Phase 2 Policy Evals

Add privacy and policy evals around account access, calendar-derived context, email-derived drafts, and contact import behavior.

#### Phase 3: Shared Household Context

Goal: Support Nick and Mara shared context without leaking private notes.

Deliverables:

- Shared household workspace
- Private, shared, and household scopes
- Shared reminders
- Gift ideas
- Family and social event tracking
- Permission-aware agent responses

Vertical slice issue seeds:

- Add workspace and membership model.
- Add scope enforcement to memory, follow-up, and draft queries.
- Build shared reminders page.
- Add household gift ideas and birthday planning view.
- Add privacy-boundary evals for shared context.

#### Phase 4: Advanced Agentic Behavior

Goal: Add more advanced Eve capabilities after the core loop is useful.

Deliverables:

- Memory curator subagent
- Message drafter subagent
- Privacy guard subagent
- Contact import sandbox workflows
- More advanced follow-up ranking
- Optional Slack or Telegram quick-capture channel
- More robust eval suite

Vertical slice issue seeds:

- Add memory-curator subagent with restricted write access.
- Add message-drafter subagent with read-only profile context.
- Add privacy-guard subagent for shared-context review.
- Use sandbox for vCard/CSV import cleanup preview.
- Add Slack or Telegram quick-capture channel.
- Add eval suite to CI.

#### Phase 5: Productization or Open Source

Goal: Decide whether Tendnote stays private, becomes an OSS template, or becomes a product.

Deliverables:

- Public-safe repo cleanup
- Mock demo mode
- Self-hosting docs
- Data export/import
- Security documentation
- Optional billing and hosted version

Vertical slice issue seeds:

- Split private data from reusable framework code.
- Add mock dataset and demo environment.
- Add self-hosting documentation.
- Add data export and delete workflows.
- Add landing page and waitlist if pursuing production SaaS.

### Technical Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Eve is beta and APIs may change | Rework may be needed | Keep agent layer thin, isolate Eve-specific code, pin versions. |
| Agent invents memories | Trust failure | Store source/confidence, run no-fake-memory evals, require explicit save. |
| Follow-up suggestions become annoying | User ignores product | Cap daily brief to 3 items and allow dismiss/snooze feedback. |
| Integrations expose too much data | Privacy concern | Preview-first imports, scoped reads, audit logs, approval gates. |
| Shared household context leaks private notes | Major trust issue | Enforce scope in DB queries and evals, not only prompts. |
| Full CRM scope creep | MVP stalls | Keep sales CRM features out of scope. |
| Open source leaks private context | Security and privacy issue | Keep personal data, `.env`, and private prompts out of repo. |

---

## 6. Issue Creation Guidance for Codex

A fresh coding agent should convert this PRD into issues by phase. Each issue should include:

- Goal
- User story
- Acceptance criteria
- Files likely touched
- Technical notes
- Tests or evals required
- Out-of-scope notes

Recommended first issue batch:

1. Scaffold Turborepo with pnpm workspaces, `apps/web`, `apps/agent`, `packages/db`, `packages/domain`, and `packages/config`.
2. Scaffold Next.js app inside `apps/web` and Eve agent workspace inside `apps/agent`.
3. Add Tailwind, shadcn/ui, and AI Elements setup for the initial assistant surface.
4. Add Better Auth setup backed by Neon Postgres.
5. Add shared domain types, validation schemas, and enums in `packages/domain`.
6. Add Drizzle schema, Neon client, and migrations in `packages/db`.
7. Align Phase 0 schema and domain code with the Phase 1 source-record, memory lifecycle, sensitivity, relationship type, and duplicate-name decisions.
8. Add people CRUD and search.
9. Add Eve `search_people` and `create_person` tools.
10. Add source records and atomic memory capture flow with suggested/approved states.
11. Add person context snapshots and snapshot-backed profile retrieval.
12. Connect web chat to Eve for people search, explicit person creation, source-record capture, explicit memory capture, and review components.
13. Add Postgres full-text search.
14. Add pgvector semantic relationship-context retrieval.
15. Add manual follow-up creation and status updates through UI and Eve.
16. Add the relationship agenda read model and Eve `get_relationship_agenda` tool for cross-person upcoming-context questions.
17. Add persisted daily brief generation and schedule.
18. Add Tendnote-only draft message tool and draft review UI.
19. Add no-send-without-approval eval.
20. Add no-fake-memory eval.

Definition of done for an MVP issue:

- Feature works through UI or agent tool.
- Data writes are persisted and visible in the app.
- Mutating operations are auditable.
- External actions require approval.
- Relevant tests or evals exist.
- Mock data can demonstrate the feature without real personal data.

---

## 7. Decisions and Remaining Open Questions

### Resolved Decisions

| Decision | Final Direction |
|---|---|
| Monorepo strategy | Turborepo with pnpm workspaces |
| Branding/casing | Tendnote for brand, `tendnote` for code and infrastructure |
| Database provider | Postgres on Neon |
| ORM | Drizzle ORM with Drizzle Kit migrations |
| Auth | Better Auth |
| UI foundation | Tailwind CSS, shadcn/ui, and AI Elements |
| Memory storage/retrieval | Neon Postgres first, then context snapshots, Postgres full-text search, and pgvector |
| Domain | `tendnote.com`, with `.dev` for docs/dev if purchased |

### Remaining Open Questions

These do not block Phase 0 or the first vertical slice.

| Decision | Recommended Default |
|---|---|
| First non-web channel | Email digest or Telegram, not SMS |
| First integration | Google Calendar before Gmail |
| Shared household timing | Phase 3 only after scope rules exist |
| Open source timing | After private MVP proves useful |

---

## 8. Source References

Use these references when implementing or creating issues:

- Vercel Eve overview: https://vercel.com/eve
- Eve introduction docs: https://eve.dev/docs/introduction
- Eve GitHub repository: https://github.com/vercel/eve
- Neon docs: https://neon.com/docs/introduction
- Drizzle ORM docs: https://orm.drizzle.team/docs/overview
- Better Auth docs: https://better-auth.com/docs/introduction
- AI Elements docs: https://elements.ai-sdk.dev/
- Local Eve docs note: after installing Eve, coding agents can read docs from `node_modules/eve/docs`.

Implementation should follow the current Eve docs at development time because Eve is in beta and APIs may change before general availability.
