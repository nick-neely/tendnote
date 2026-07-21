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

##### Phase 2F: Eve-Native Eval Foundation

Rework Tendnote's agent eval suite around Eve-native evals that cover the full agent-behavior spectrum: safety and policy gates, tool choice, source grounding, refusal behavior, instruction and skill quality, model suitability, and CI/reporting ergonomics. The earliest slices should be policy-only and deterministic, but this PRD should carry the eval foundation through to a complete baseline rather than leaving quality and model-comparison work as recurring follow-up debt.

- Keep product-rule tests near the logic they protect: `packages/domain`, `packages/db`, integration seams, web parsing/rendering, and thin adapter boundaries.
- Start with one dedicated inventory-and-relocation slice for every current `apps/agent/evals/*.test.ts` file: move useful Vitest-style wrapper/source-scan tests into the package or module that owns the protected behavior, remove redundant coverage when the owner already has better tests, and document anything intentionally converted later. After that pass, reserve `apps/agent/evals` for Eve-native `.eval.ts` files only.
- Refresh and extend the existing synthetic demo/fixture base rather than creating a parallel dataset from scratch. Use `packages/db/src/demo-data.ts`, `packages/db/src/seed.ts`, and existing fake adapters as the starting point, updating them for Phase 2A-2E coverage where stale.
- Add an eval-specific database reset/seed harness that points Eve evals at a stable isolated local Postgres database such as `tendnote_eval`, not the developer's normal `tendnote` local database. The harness should hard-reset the eval database before each suite, apply committed Drizzle migrations, seed the synthetic fixture data, run evals with `DATABASE_URL` pointed at the eval database, and support repeatable reset for debugging. Per-run temporary databases can be deferred until CI parallelization or sharding requires them.
- Convert agent-behavior coverage into Eve cases driven through real sessions, using `defineEval`, `evals.config.ts`, assertions, tags, targets, datasets, and strict/JUnit-friendly output.
- Slice the first Eve-native suite around deterministic policy gates: pending-access users cannot reach normal Eve behavior, Calendar context stays read-only/provider-derived, Gmail draft creation never sends or reads mailbox history, and Contacts import never infers memories, follow-ups, semantic context, Gmail drafts, or outbound actions.
- Add deterministic behavior evals for correct tool choice, forbidden tool calls, expected tool calls, refusal behavior, source-grounded recall, disambiguation, approval flow parking/responding, and external-action boundaries.
- Add judge-backed quality evals only after deterministic gates are stable, covering tone, factuality, draft usefulness, grounded summarization, brief usefulness, and instruction/skill quality where exact assertions cannot capture correctness.
- Add model-comparison eval support with explicit tags, cost/credential gates, and reportable outputs so Tendnote can compare candidate agent and judge models without making normal CI flaky or expensive.
- Add CI/reporting support: fast deterministic strict Eve evals should be the normal blocking CI path; judge-backed and model-comparison runs should be explicit, credential-gated commands or scheduled/manual workflows so normal CI does not burn LLM tokens, slow every change, or fail on provider noise. Include JUnit output, JSON artifacts, and documented commands for local and deployed targets.
- Expose clear commands: a deterministic `pnpm eval:agent` path that performs eval DB reset/seed and runs strict Eve evals, plus explicit heavier commands such as `pnpm eval:agent:judge`, `pnpm eval:agent:models`, and `pnpm eval:agent:list` for judged quality checks, model comparison, and discovery/debugging.
- Keep eval data synthetic and upload-safe. Do not depend on Nick's personal data, production data, or live Google APIs; fixture gaps should be filled by extending the existing demo data and fake adapters.
- Do not add new product behavior, Google scopes, provider sync, shared-household privacy behavior, or external actions in this phase. This phase upgrades verification architecture before broader privacy-sensitive work.

#### Phase 3: Advanced Private Eve Behavior

Goal: Make Eve materially more useful as a private relationship assistant before adding shared-household privacy behavior. Eve may notice, organize, suggest, draft, and prepare, but Tendnote remains the source of truth for approval, persistence, and external action boundaries.

Deliverables:

- Discord-first private capture channel for owner-scoped quick capture, HITL review, and explicit opt-in proactive delivery (ADR 0122)
- Memory curator subagent for review-only cleanup proposals (ADR 0123)
- Relationship strategist subagent for advanced private agenda ranking and review-gated suggested follow-ups (ADR 0124)
- Message drafter subagent for variants, revisions, source-grounded drafting, and proactive draft proposals that require explicit persistence (ADR 0125)
- Contact/file cleanup sandbox workflows for cleanup previews from CSV/vCard and messy pasted context (ADR 0126)
- Advanced private schedules for Morning Agenda, Post-Meeting Aftercare, Weekly Relationship Review, and Birthday/Gift Planning (ADR 0127)
- Dynamic skills for high-value relationship workflows such as gift planning, meeting prep, relationship repair, birthday messages, memory cleanup, follow-up strategy, and drafting
- Five explicit Eve modes that narrow tools and skills by workflow: Discord Capture Mode, Selected Person Mode, Drafting Mode, Scheduled Workflow Mode, and Cleanup Preview Mode (ADR 0128)
- No generic Eve MCP/OpenAPI connections; external services remain Tendnote-owned provider connections with explicit product semantics (ADR 0129)

Vertical slice issue seeds:

1. Add the Eve modes foundation: mode selection, dynamic skills/tools, owner/channel context rules, and the five baseline modes — Discord Capture Mode, Selected Person Mode, Drafting Mode, Scheduled Workflow Mode, and Cleanup Preview Mode.
2. Add Discord private capture channel with owner mapping, slash-command capture, HITL components/modals, and explicit per-workflow target setup for proactive private nudges. Scheduled artifacts persist in Tendnote first; Discord delivery is opt-in and failure must not lose the artifact.
3. Add memory-curator subagent that can read eligible private context and propose reviewable memory edits, archive candidates, duplicate cleanup, contradiction prompts, source-record cleanup suggestions, or clarification questions without directly approving, editing, archiving, merging, or deleting durable memories.
4. Add message-drafter subagent that proposes, previews, creates, and revises Tendnote message drafts with multiple tone variants and source references. It may proactively suggest or preview a draft, but it must create a persisted Tendnote message draft only after explicit owner intent; Gmail externalization keeps the existing approval gate.
5. Add relationship-strategist subagent that uses the relationship agenda, Calendar context, follow-ups, birthdays, drafts, and semantic context to propose private reviewable next actions. It may create `suggested` follow-ups through the existing review-gated path, but must not create active follow-ups, memories, source records, drafts, or external actions.
6. Add private scheduled workflows for Morning Agenda, Post-Meeting Aftercare, Weekly Relationship Review, and Birthday/Gift Planning using app-owned dispatcher rows and shared owner-scoped product functions. Defer continuous background scanning, arbitrary high-frequency sweeps, autonomous draft creation, unconfigured Discord push delivery, and shared-household-aware scheduling.
7. Add sandbox-backed cleanup previews for CSV/vCard files, pasted lists, old notes, exported text/JSON, and other messy owner-supplied private context. The sandbox may parse, normalize, and dedupe candidates, but durable people, memories, contact methods, source records, and follow-ups still require confirmation through Tendnote review surfaces; Google Contacts import stays separate.
8. Defer Slack, Telegram, shared household behavior, new eval-suite scope, generic Eve MCP/OpenAPI connections, and all external sends or autonomous external draft creation. Discord is a channel, and existing Google Calendar, Gmail, and Contacts capabilities remain behind Tendnote-owned provider seams.

#### Phase 4: Household/Scope Foundation

Goal: Add the permission substrate for shared household behavior before broadening Tendnote into a multi-domain Personal OS. This phase should prove that private, shared, and household visibility rules are enforced in shared queries, web surfaces, Eve responses, and scheduled/proactive behavior before richer household product workflows are added.

Deliverables:

- Household Workspace and membership model for multiple invited members with Owner and Member roles plus visibility controls (ADRs 0130, 0131)
- Private, shared, and household visibility scopes where Owner role does not pierce private records (ADR 0132)
- Scope enforcement for memories, source records, follow-ups, drafts, briefs, review items, and Eve tools
- Permission-aware Eve responses that can use mixed visible scopes while preserving provenance and scope boundaries (ADR 0136)
- Minimal shared person/relationship reminder behavior as the proof artifact for scope enforcement, while shared memories, shared drafts, and general non-person actions remain future-compatible and deferred (ADRs 0133, 0134)
- Privacy-boundary tests/evals for shared context
- Privacy Guard subagent only after deterministic query/action scope enforcement exists, and only as a reviewer rather than the access boundary (ADR 0137)

Vertical slice issue seeds:

1. Add lightweight Household Workspace, invitations, Owner/Member roles, membership lifecycle, member removal behavior, and audit without adding multi-workspace switching, organization/team behavior, CRM account semantics, or a broad admin console.
2. Add the private/shared/household scope model, selected-member sharing, record-level visibility controls, household future-member behavior, and removed-member access revocation.
3. Add scope enforcement across existing owner-scoped read/write seams, including memories, source records, Follow-Ups, drafts, briefs, review items, retrieval, and Eve tool outputs.
4. Add minimal shared person/relationship Follow-Up behavior to prove shared action visibility. Do not build general non-person reminders/actions, rich shared memory, or shared draft workflows in Phase 4, but keep the Household Workspace model compatible with those future Personal OS and Phase 8 household OS behaviors.
5. Add permission-aware Eve responses and assistant rendering for private, shared, and household records. Allow Eve to combine the caller's private records with visible shared and household records in one useful answer, while preventing leakage of another member's private records and preserving scope/provenance in phrasing and assistant component payloads.
6. Add privacy-boundary tests/evals for shared context, with deterministic policy enforcement as the required security boundary.
7. Add Privacy Guard subagent after deterministic shared-context query/action enforcement exists; it may review, flag, revise, or require clarification for Eve outputs and proposed shared-context actions, but deterministic scope enforcement remains authoritative.

#### Phase 5: General Actions Foundation

Goal: Add the first non-people Personal OS vertical by supporting General Actions such as "replace the refrigerator water filter" without forcing every action to belong to a person. This phase should make Actions and Routines useful through direct creation, review-gated capture, Eve, semantic retrieval, household scope, recurrence, Areas, and a narrow Action Today surface while avoiding project-management, external task-system, notification-system, and full mobile Personal OS scope.

Deliverables:

- Separate General Action model from person-centered Follow-Ups, with shared lifecycle vocabulary where useful (ADR 0143)
- User-facing Actions surface, with Routines as the product label for recurring General Actions and Suggested actions for review proposals (ADR 0148)
- Bounded Personal OS action model with lifecycle, due/defer timing, recurrence, Area, resurfacing semantics, visibility scope, source grounding, provenance, optional person links, and lightweight asset hints, while deferring priority and effort classifications (ADRs 0145, 0149, 0154, 0155, 0156)
- Flat custom Areas seeded with useful defaults, without tags, nested taxonomies, or area-level permissions (ADR 0146)
- Direct active creation for intentional user form input, plus review-gated Suggested General Actions for Eve, Discord, fast capture, imported/provider-derived context, and extraction outputs (ADRs 0144, 0151, 0152)
- Source Record action extraction that reuses the existing extraction job pattern and creates Suggested General Actions rather than hidden Source Record action metadata (ADR 0151)
- Semantic retrieval and Eve-first tools for creating explicit actions, proposing suggested actions, shallow planning, listing due/overdue/deferred/resurfaced actions, searching actions by meaning, and answering cross-domain questions after deterministic scope filtering (ADRs 0150, 0159, 0163)
- Phase 4 private/shared/household visibility scopes on General Actions and Suggested General Actions, with scope-filtered retrieval, Eve tools, proactive summaries, and Discord delivery (ADRs 0153, 0158)
- Narrow Action Today surface for due, overdue, and deliberately resurfaced Actions/Routines, plus mobile-usable action creation, review, and lifecycle controls without building the full Phase 7 Today/mobile shell (ADRs 0157, 0161)
- Lightweight links/notes and action history signals without document management, productivity analytics, gamification, predictive prioritization, priority or effort classifications, or autonomous cadence changes (ADRs 0164, 0165)

Vertical slice issue seeds:

1. Add General Action, Suggested General Action, Area, recurrence, lifecycle/history, scope, provenance, optional person links, and asset-hint domain/schema foundation without merging the model into Follow-Ups.
2. Add the Actions surface for direct creation, editing, completion, defer/snooze, archive, Areas, filters, Routines, and mobile-usable basics.
3. Add Suggested General Actions to the shared Review Queue and Actions surface, with source grounding, editable metadata, accept/edit/dismiss, and idempotent promotion.
4. Extend Source Record extraction jobs for action extraction that creates Suggested General Actions from Eve, Discord, fast capture, and provider-derived context.
5. Extend semantic retrieval, exact recall, embeddings, and typed retrieval contracts for General Actions and Suggested General Actions with household scope filtering.
6. Add Eve tools for explicit action creation, shallow planning, suggested-action proposal, action search/listing, and explicit-turn lifecycle mutations with audit/provenance.
7. Add narrow Action Today, resurfacing rules, recurring Routine roll-forward/completion history, and scoped scheduled/proactive summaries including Discord delivery where configured.
8. Add tests/evals for lifecycle, recurrence, scope, review promotion, extraction idempotency, retrieval filtering, Eve behavior, proactive delivery, mobile-usable UI behavior, and out-of-scope guardrails.

Proof scenario:

- A user captures that the refrigerator water filter needs replacing every six months. Tendnote stores source grounding, Eve proposes a Suggested General Action with Home Area, Routine recurrence, household scope, and a lightweight asset hint. The user reviews and accepts it, sees it in Actions, gets it surfaced when due, can retrieve it later through Eve/semantic search, and can receive scope-safe proactive or Discord delivery without introducing full Asset Memory.

#### Phase 6: Asset Memory

Goal: Add the second Personal OS vertical on top of the general reminders/actions foundation by supporting Assets such as household items, appliances, vehicles, subscriptions, services, warranties, evidence, and maintenance history without turning assets into people, building a document manager, or flattening all domains into one vague table.

Deliverables:

- Asset records for practical owner- or household-scoped managed resources, including items, appliances, vehicles, subscriptions, services, and property/place anchors where needed (ADR 0170)
- Asset Visibility using Phase 4 private/shared/household scopes, where an Asset's scope is the broadest allowed visibility for child records and child records may be narrower (ADR 0179)
- Asset lifecycle with archive as the normal inactive path and hard delete reserved for correction/privacy cases (ADR 0177)
- Asset Memory as durable reviewed personal context anchored to Assets, with a small typed shape for structured values and freeform notes while keeping Relationship Memory as the person-centered variant of Memory (ADR 0181)
- Suggested Assets and Suggested Asset Memories for inferred asset context, with direct creation reserved for explicit user intent and low-friction batch review for grouped low-risk suggestions (ADRs 0169, 0176)
- Asset review reuse of the existing Review Queue, with expanded grouped-review UX for asset suggestions, evidence, links, duplicate prompts, and asset-derived Suggested General Actions rather than a separate asset inbox (ADR 0191)
- Asset Duplicate Review during capture/review to suggest linking to existing Assets before creating near-duplicates, while deferring full Asset merge (ADR 0189)
- Promotion or linking of Phase 5 General Action asset hints into lightweight Asset anchors before detailed Asset Memories exist (ADR 0168)
- Lightweight Related Asset Links for explicit or reviewed relationships such as fits, uses, part of, replaces, covers, or stored with, without full asset hierarchy or graph behavior; inferred links are review-gated by default (ADRs 0174, 0175)
- Lightweight Asset Person Links for useful context without making people the owners of assets or the source of asset visibility (ADR 0178)
- Asset Evidence for receipts, photos, serial numbers, maintenance notes, warranties, manuals, links, retained extracted text, and subscription details, including a polished mobile-friendly image/upload/drop-zone foundation and lightweight Eve chat plus-menu capture without introducing document-library, file-manager, or full OCR/document-intelligence behavior (ADRs 0171, 0184, 0185)
- Lightweight amount, currency, purchase date, renewal date, and receipt metadata for recall and evidence without finance, budget, reporting, tax, or subscription-management behavior (ADR 0182)
- General Actions tied to Assets, such as replacing filters, renewing warranties, inspecting a car, or canceling a subscription, while reusing the Phase 5 action lifecycle; reviewed Asset Memories can propose Suggested General Actions for expirations, renewals, and maintenance intervals (ADR 0183)
- Dedicated Assets surface and Asset Profiles as the coherent read home for asset context, with strong desktop/mobile browsing, sorting, filtering, pagination or incremental loading, and Actions, Review, Eve, and mobile capture deep-linking into the same profiles and review flows (ADR 0186)
- Internal Asset Audit for writes, reviews, and automated proposals, distinct from user-facing Asset History (ADR 0192)
- Asset Snapshots as rebuildable generated caches with citations to supporting records, not source of truth (ADR 0180)
- Unified Asset Search UX over exact text, structured values, and fuzzy intent, backed by distinct typed exact-recall and semantic-retrieval contracts for UI and Eve (ADR 0187)
- Proactive asset surfacing through existing review items, Suggested General Actions, scoped proactive summaries, and due asset-related General Actions without adding a standalone asset notification system or autonomous asset manager (ADR 0188)
- Eve responses over asset context with typed result contracts
- Targeted Eve asset evals and deterministic policy tests for scope, citations, snapshot boundaries, review-gated writes, related links, proactive surfacing, and shared Asset Evidence Capture (ADR 0193)

Vertical slice issue seeds:

- Add Asset, Asset Kind, Asset Memory, Asset Evidence, Suggested Asset, and Suggested Asset Memory domain language plus the smallest schema needed for useful asset anchors.
- Add internal Asset Audit for created, edited, accepted, dismissed, linked, archived, and proposed asset changes with actor, source, scope, and provenance.
- Add Asset Visibility with deterministic scope filtering across Asset Memories, Asset Evidence, Related Asset Links, Asset Person Links, related General Actions, retrieval, and Eve outputs.
- Add Asset archive/inactive behavior before hard delete, preserving useful memories, evidence, related links, actions, and history according to scope.
- Expand Review Queue UX for grouped asset review by source/upload/session/Eve turn, including batch actions, inline edits, link-to-existing-asset prompts, and Assets-surface deep links.
- Add Asset Duplicate Review so suggested or captured asset context can link to existing Assets before creating new anchors, while deferring full merge.
- Link source records, Relationship Memories where relevant, General Actions, Asset Evidence, lightweight Related Asset Links, and lightweight Asset Person Links to Assets without replacing people-first relationship records.
- Add the shared Asset Evidence Capture foundation with mobile image capture, drop-zone upload, Eve chat plus-menu camera/gallery/file entry points, evidence metadata, and attachment to Assets or asset review items, while deferring full OCR, image understanding, bulk document import, and document inboxes.
- Add the Assets surface and Asset profile/read surface with source-grounded Asset Memories, Asset Evidence, related General Actions, links, archive state, Asset History, snapshot-backed summaries, responsive desktop/mobile UX, sorting/filtering, and pagination or incremental loading.
- Extend capture, grouped review, Asset Search, exact recall, semantic retrieval, snapshots, and Eve responses for Assets and Asset Memories.
- Add maintenance/subscription reminder flows that reuse the General Action lifecycle.
- Add scoped proactive asset surfacing through existing review/action/proactive-summary channels, with capped explainable behavior tied to visible records.
- Add asset policy tests and Eve evals for visibility filtering, citation/provenance, snapshot cache behavior, review-gated mutations, suggested action generation, related-link proposals, proactive surfacing, and Eve plus-menu evidence capture.

First implementation chain:

1. Asset domain/schema foundation, including Asset Kind, Asset Memory, Asset Evidence, Suggested Asset records, Suggested Asset Memory records, visibility scope, audit, archive state, and lightweight links.
2. Review Queue expansion for grouped asset review, including Suggested Assets, Suggested Asset Memories, Related Asset Links, Asset Evidence, duplicate-review prompts, batch actions, and link-to-existing-asset flows.
3. Shared Asset Evidence Capture foundation, including mobile image capture, drop-zone upload, Eve chat plus-menu camera/gallery/file entry points, evidence metadata, and attachment to Assets or asset review items.
4. Assets surface and Asset Profiles, including responsive desktop/mobile browsing, sorting, filtering, pagination or incremental loading, archive state, Asset History, Asset Evidence, related actions, related assets, person links, and snapshot-backed summaries.
5. General Action integration, including asset-linked actions, asset history rendering from action history, maintenance/subscription reminder proposals from reviewed Asset Memories, and Action Today/proactive-summary compatibility.
6. Asset Search, exact recall, semantic retrieval, Asset Snapshots, and Eve asset tools/responses with typed result contracts and citations.
7. Proactive asset surfacing, deterministic policy tests, and targeted Eve asset evals covering scope, provenance, snapshot boundaries, review-gated writes, related links, suggested actions, and shared Asset Evidence Capture.

Proof scenario:

- A user captures that the refrigerator water filter needs replacing every six months. Phase 5 may already have a General Action with a lightweight asset hint; Phase 6 promotes or links that hint to a real Asset. The user can add filter size, model, warranty, manual, receipt, or maintenance evidence later as reviewed Asset Memories and Asset Evidence, see replacement history on the Asset profile, ask Eve "what filter does the fridge need?", and preserve household scope across retrieval and proactive surfaces (ADR 0172). Cars and subscriptions are secondary scenarios, not the first implementation anchor.

Deferred Asset Memory follow-ups:

- Explicit automation or trusted-agent modes that reduce review friction for low-risk asset updates or related links. Phase 6 should keep review-gated defaults, grouped review, audit, and future undo semantics compatible with this direction rather than silently auto-applying inferred context.
- Richer Asset Evidence intelligence, including OCR, image understanding, receipt parsing, manual/warranty extraction, bulk import, document inboxes, arbitrary file Q&A, and general multimodal chat memory.
- External asset-context imports from providers such as Gmail receipts, Google Drive, Amazon/order history, banking/card transactions, Home Assistant, merchant accounts, or warranty/service portals. These are high-value follow-ups, but Phase 6 should first prove the manual/upload/link/source-record Asset Memory model while keeping provider-compatible provenance and minimization boundaries.
- Full related-asset graph behavior, including asset hierarchies, component trees, inherited permissions, inventory rollups, cascading lifecycle rules, and graph workflows. Phase 6 only includes lightweight explicit or reviewed links.
- Full Asset merge workflows that reconcile memories, evidence, actions, links, snapshots, embeddings, and audit history. Phase 6 only includes duplicate review/link-before-create prompts.
- Full finance or subscription-management behavior, including budgets, spend analytics, tax workflows, renewal negotiation, account balances, subscription dashboards, and cancellation automation. Phase 6 only keeps lightweight amount, renewal, and receipt metadata for recall/evidence.
- Standalone document library or file manager behavior. Asset Evidence should stay grounded in Asset profiles and review flows until a later Personal OS capture/document phase earns its own product surface.
- Broader mobile Personal OS capture and Today behavior beyond the Asset Evidence capture foundation. Phase 7 remains the larger mobile-first operating layer.

#### Phase 7: Personal OS Capture and Today Layer

Goal: Add the mobile-first operating layer for broad personal capture, routing, a calm Today shortlist, and slipping/resurfacing across people and the first non-people vertical.

Deliverables:

- Mobile-first capture surface and PWA-oriented access
- Fast capture confirmation and routing
- Saved Items as the narrow source-grounded fallback for notes, links, and open questions without a better supported destination
- Today dashboard across relationship context, reminders/actions, Calendar context, and review items
- Slipping/resurfacing rules for stale context, overdue actions, unresolved decisions, and saved items worth revisiting
- Global search and grounded Eve chat across supported domains
- Explicit owner-chosen reminder alerts through opted-in browser and PWA installations

Agent-backed surface contract:

- Today, search, review, and resurfacing are purpose-built surfaces over the same owner-scoped product functions as Eve, not hidden chat turns or separate agents. When a control or query already expresses structured intent, its authenticated server boundary calls the shared function directly; the client never supplies the authoritative owner scope or reimplements product policy.
- Reasoning that is actually needed is exposed as a named Agent Capability with typed, channel-neutral input and output. Eve reaches it through a thin tool adapter and purpose-built surfaces through thin server adapters, so channels may present the result differently without changing its facts, eligible actions, grounding, trust state, or approval requirements.
- Deterministic server policy remains authoritative for visibility, lifecycle eligibility, mandatory inclusion or exclusion, shortlist caps, and approval gates. An Agent Capability may interpret, generate, semantically retrieve, rank, or explain only within its validated scope; its output is revalidated before use and may not create eligibility or authorize a mutation.
- Opening Today may automatically invoke its declared read-only ranking and explanation capability over an already policy-filtered, bounded candidate set. It performs no writes or new provider access, observes a tight timeout, and falls back visibly to stable deterministic ordering; other capabilities require the intent expressed by their control or query.
- Read-only search, ranking, and explanation results may remain ephemeral when they include typed authoritative-record references, source grounding, and trust metadata. Any output that is actionable, reviewable, reloadable, or expected to survive refresh must first be persisted as the appropriate domain or review artifact, and controls must reload that authoritative record before acting.
- A clear, bounded purpose-built control is explicit user intent and does not need conversational reconfirmation. Shared mutations still enforce ownership, freshness, validation, audit, and approval policy, while consequential external actions retain their dedicated preview and confirmation gates.
- Capability fallbacks are defined at the server boundary rather than improvised by clients: Today may use deterministic ordering, search may identify an exact or structured fallback, generation-only behavior reports unavailable, and mutations whose arguments depended on failed reasoning fail closed. Minimized operational traces cover capability identity/version, authenticated owner, timing, outcome, and failures under bounded retention; durable product audit remains required for mutations and persisted generated artifacts retain their source references and generation provenance.

Saved Item lifecycle and trust contract:

- A Saved Item is the first-class fallback only for an explicit note, link, or open question that has no better supported destination. The fixed starting kinds are `note`, `link`, and `open_question`; Phase Seven does not turn Saved Items into generic attachments, a document inbox, a tag system, or a catch-all record model.
- Explicit capture intent may create a Saved Item directly. A Saved Item inferred from existing context remains review-gated. The editable Saved Item is a durable product record linked to the immutable Source Record that preserves the owner's minimized original wording; editing the item never rewrites its evidence.
- A Saved Item is `active` or `archived`. It may carry one optional `bringBackAt`, but it has no completion, priority, recurrence, or deferred status. Resolving an open question archives it with a resolution reason and optional links to the records that hold the outcome.
- Saved Items are private by default. Eve may create selected-member or household visibility only when the owner explicitly names that audience, and confirmation states the chosen scope; content, links, and plural wording never imply sharing.
- An active dated Saved Item becomes eligible when its bring-back time arrives. An undated active item may become only a low-weight Today candidate after deterministic age and cooldown gates, subject to the Today cap and a factual explanation. Retrieval relevance alone never authorizes resurfacing or mutation.
- Active Saved Items participate in exact recall, semantic retrieval, structured search, and grounded Eve answers after deterministic scope filtering. Archived items require an explicit archived-record request. Raw Source Records remain evidence rather than an independent result family.
- Explicit promotion creates the supported destination record, links it to the Saved Item and shared evidence, and archives the item as resolved. Inferred promotion remains review-gated, retries are idempotent, and a correction preserves the original evidence rather than silently replacing it.
- Archive is the normal removal path. Deleting captured source is a separate privacy or correction action that removes uniquely owned evidence and derived retrieval material; shared evidence requires an impact disclosure. Internal audit records lifecycle and mutation attempts without adding a user-facing history feed.

Conversational capture and routing contract:

- The expanded Today Eve composer and persistent global Capture action accept typed or dictated input without requiring a form. Normal questions in the Eve composer remain conversational and are not saved automatically; opening the Capture action, or explicitly asking Eve to save or bring back a question, supplies capture intent. Eve may offer to save a useful conversational question, but it may not persist one without that intent.
- Explicit supported intent proceeds directly through the destination domain's owner-scoped mutation or required review flow. Eve may create an active Follow-Up, General Action, approved Memory, minimal Person, or other directly writable record when the owner clearly requests it and every consequential field is resolved; destinations whose existing trust contract requires review, including inferred outcomes and Asset facts, still produce their typed review artifact rather than silently becoming durable truth. An inferred secondary outcome never borrows authority from an explicit capture.
- One capture may produce multiple Capture Outcomes when the owner explicitly requests them, with every outcome grounded in the same Source Record. Eve must not silently fan one statement into additional durable records; inferred secondary outcomes are persisted only as reviewable suggestions. A single compact grouped confirmation represents a multi-outcome capture.
- Routing prefers the most specific supported destination: relationship context or an explicit Memory, a person-scoped Follow-Up, a non-person General Action, the existing Asset evidence or Asset Memory review path, then a Saved Item for an explicit note, link, or open question with no better supported destination. Low-confidence overlap between harmless destinations falls back privately to a Saved Item with a visible `Change` action. Ambiguity that could choose the wrong person, date, scope, durable fact, lifecycle, or external effect requires clarification rather than a guess.
- Capture is save-first. Before asking a consequential clarification, Tendnote persists the original input as a Pending Source Record so abandoning the exchange cannot lose it. Reminder timing uses a visible editable default and asks one focused question only when the requested timing is genuinely ambiguous or impossible, while an unscheduled General Action remains valid; deterministic phrases such as `tomorrow` or `Friday` resolve in the owner's timezone, while genuinely vague timing does not become an invented date.
- A name mention does not silently create a Person. When no confident match exists, Tendnote retains personless pending context and immediately offers compact `Add <name>` and `Link someone else` actions; the first creates a minimal Person and attaches the capture in one step, while ignored pending context remains available in the Review Queue. Explicit `add <name>` intent may create the minimal Person directly.
- Every outcome points to the minimized Source Record containing the owner's meaningful original wording, capture time, and surface. Dictation retains the transcript rather than audio by default. Routing audit records the destination, explicit-versus-inferred authority, actor, source, and a short user-facing reason for inferred routing, never model chain-of-thought; normal confirmation stays quiet while review detail may explain `Why this?`.
- Confirmation appears only after the authoritative write succeeds and shows the destination plus only consequential interpreted fields, with compact `Change` and, where safely reversible, `Undo` controls. It does not repeat the full input or require a correction form. Rerouting preserves the original Source Record, reverses or archives the mistaken outcome according to its domain lifecycle, creates the corrected outcome, and audits the transition; changing one member of a grouped capture leaves the others alone.
- Capture remains private unless the owner explicitly names a shared scope or starts from an already shared record or surface; plural wording such as `we need` never expands visibility. An exact rapid resubmission from the same capture interaction returns the existing confirmation, while semantically similar later captures remain distinct evidence. If a network or routing failure prevents a durable write, Tendnote says it was not saved, preserves the text or transcript locally for retry or copy, and does not queue an offline background write.

Global recall and structured search contract:

- Global Recall is one owner-scoped federated read capability shared by Eve and the lightweight search overlay. Its user-facing result families are People and relationship context, Follow-Ups, Actions and Routines, Assets and Asset Memories, Saved Items, and Calendar events available through the existing read boundary. Raw Source Records, evidence, generated snapshots, and audit records support or ground canonical results but never appear as independent result families.
- Exact lexical retrieval and semantic retrieval run together for every meaningful query. Names, titles, identifiers, quoted phrases, dates, and explicit domain terms produce Exact candidates; natural-language meaning produces Related candidates. The server merges and deduplicates them by canonical record, exact matches always outrank semantic similarity, and weak semantic confidence yields an honest limited-results state rather than speculative filler.
- Deterministic policy applies authenticated caller, visibility, sensitivity, lifecycle, and requested filters before either retrieval path. Semantic retrieval cannot broaden eligibility. Private, selected-member, and whole-household results may coexist when visible to the caller, retaining scope in the typed result, while inaccessible records leave no result, count, explanation, or other evidence that they exist.
- The default search spans every eligible family and excludes archived records. The overlay offers one primary family filter plus only relevant contextual quick filters such as Active, Due, Archived, or a named Person or Asset; richer dates, people, status, ownership, and visibility constraints expressed to Eve normalize into the same typed server contract. Phase Seven does not add tags, saved searches, arbitrary facets, or an advanced query builder.
- Every result uses one discriminated typed union with a common trust envelope: result family, canonical record reference, primary label, short supporting text, lifecycle state, Exact or Related match kind, bounded match reason, visibility treatment, authoritative source or evidence references, canonical deep link, optional parent context, and freshness metadata where applicable. Family payloads add only necessary facts such as due date, recurrence, `bringBackAt`, or Calendar freshness; generated prose and raw similarity scores are not UI-facing or durable result fields.
- Exact results expose the matching canonical field or short excerpt. Related results carry one bounded explanation grounded only in matched record content. Eve cites every material synthesized claim to returned authoritative records and preserves trust language such as `you noted`, `confirmed memory`, `scheduled action`, or `Calendar event`; snapshots and generated summaries may assist composition but cannot serve as citations. Insufficient grounding produces an explicit limitation rather than an answer from chat context or general model knowledge.
- The mobile overlay presents calm flat rows rather than nested cards or badge-heavy metadata. Exact matches lead and Related matches follow under plainly explained headings; each row prioritizes its title, human context, and matched excerpt, with domain, lifecycle, and source condensed into one quiet trust line. `Why this result?` progressively discloses the explanation and citations inline, the primary row action opens the canonical record, and citation links may focus the precise supporting record.
- Search navigation preserves query, filters, scroll position, and expanded explanations when the owner follows a result and returns. Canonical URLs carry stable record identity and an optional focused child identity rather than copied result text or ranking state. Missing, archived, or newly inaccessible destinations render a calm non-leaking explanation instead of a dead route. Eve citations use the same destinations.
- A deliberate search query or direct Eve question is explicit recall intent, so a visible restricted record may participate only when the query meaningfully targets it. Restricted content never appears in an empty state, suggestion, completion, recent-search preview, or loose semantic expansion; the structured overlay initially conceals sensitive excerpts and explanations behind an explicit reveal. Eve uses careful source-grounded phrasing and does not carry restricted content into unrelated turns or proactive surfaces.
- The first overlay page contains at most 12 merged results. Stable ranking uses exactness, requested filters, canonical-record relevance, lifecycle usefulness, appropriate recency, and deterministic tie-breaking; semantic similarity ranks only within Related results, while result diversity prevents one prolific Person or Asset from consuming the page. `Show more` exposes the long tail. Eve uses the same ranked contract with a bounded context pack, normally 8-15 results, and says when additional matches exist. Rank means query relevance, never inferred urgency or personal importance.
- Search remains useful through loading, empty, partial-failure, and stale-provider states without taking down the surrounding surface or silently substituting weaker truth. The complete flow is keyboard and screen-reader operable, uses at least 44-by-44 CSS-pixel touch targets, announces changes without stealing focus, restores focus predictably, preserves readable contrast at 200% text size, and honors reduced motion.

Today candidate and curation contract:

- Today may consider visible active Follow-Ups that are due or overdue; birthdays inside a deterministic preparation window; due, overdue, or deliberately resurfaced General Actions and Routines; same-day Calendar events and narrowly relevant recent-event context; persisted review items; active Saved Items whose `bringBackAt` has arrived; undated active Saved Items that pass deterministic age and cooldown gates; and source-grounded relationship context that has a concrete deterministic stale or resurfacing reason. Archived, completed, or dismissed records, restricted proactive content, raw Source Records, and bare People or Assets are ineligible; a Person or Asset appears only through an eligible attached record.
- Deterministic owner-scoped policy owns visibility, lifecycle and sensitivity gates, due and preparation windows, cooldown and prior-feedback suppression, deduplication, per-family bounds, mandatory inclusion, and the bounded candidate pool. Each candidate carries authoritative identity, source references, allowed actions, and factual reason codes. Eve may rank optional candidates for relevance and cross-domain balance and phrase their explanations, but it cannot add an ineligible record, remove a mandatory record, alter an action, or persist a hidden score. On failure, Today orders time-bound items first, then explicit bring-backs, then the oldest eligible items while balancing domains.
- Today shows at most five items and normally targets three. When more than five time-bound items qualify, deterministic policy fills the cap with the oldest overdue items followed by chronological due order, and the surface offers a quiet count-and-link to the relevant complete domain surfaces; Eve does not choose which time-bound items survive the cap, and omission never mutates or dismisses a record.
- Eligibility refreshes when Today opens and immediately after an owner action. Eve recuration runs only when the eligible candidate fingerprint changes, the owner explicitly refreshes, or the owner's local day rolls over; otherwise ordering remains stable for the visit. There is no background reshuffling, unread count, or persisted priority or effort classification.
- Every item shows one concise `why today` explanation derived from its factual reason code, such as due timing, an explicit bring-back, a birthday preparation window, record age plus cooldown, or time awaiting review. Eve may make the wording natural but must not infer importance, urgency, intent, or emotional significance; deterministic copy remains available as fallback.
- `Act` uses the backing record's real domain control, such as completing a General Action or Follow-Up, opening a review item, viewing a Calendar event, or opening its supporting record; Today has no generic completion mutation. `Later` creates Today-only suppression until an owner-selected time without changing the underlying due date, `bringBackAt`, recurrence, or lifecycle. `Not today` suppresses the candidate only for the rest of the owner's local day; permanent removal requires an explicit domain action. Feedback keys to authoritative candidate identity plus reason, so a materially changed record may become eligible again without inventing priority or effort.

Mobile shell and interaction hierarchy:

- Today is the normal phone launch destination. Its first region is a quiet `panel`-colored band containing only the `Today` title, local date, a subdued refresh/status control, and a white explicit Eve composer; the shortlist begins immediately below on the normal background. The tonal band groups orientation and input without turning either the composer or Today into nested cards, and the phone header adds no greeting banner, logo row, account avatar, summary metric, or count badge.
- The Today Eve composer is compact but fully usable rather than a launcher disguised as an input. Questions remain conversational unless the owner explicitly asks Eve to save; submitting or focusing into an active exchange expands to a focused full-screen Eve surface. Back returns to the same Today scroll position with its state intact, while the conversation surface gives the software keyboard, transcript, citations, and structured results the full viewport instead of pushing the shortlist into an indefinitely growing home feed.
- The shortlist uses flat Personal Ledger rows separated by hairlines, not individual cards, ordinal numbers, priority styling, or badge-heavy metadata. Each row has a quiet leading domain icon and label, record title, human context, one always-visible factual `why today` line, one contextual primary domain action, and a labelled More control containing `Open record`, `Later`, and `Not today`. The row opens the authoritative record; suppression controls never masquerade as mutations of that record.
- The persistent phone bottom bar has exactly five positions in this order: `Today`, `Search`, `Capture`, `Review`, and `Menu`. Capture is the emphasized center action with a visible label, not a floating button that can cover content. Review carries no backlog count, and Menu exposes People, Actions, Assets, Saved Items, and Account without making every domain permanent primary navigation. The bar and every fixed surface respect safe-area insets and disappear when a focused full-screen Search, Capture, or Eve flow needs the software-keyboard viewport.
- Search opens as a full-screen overlay over the current surface, focuses the query field, presents Exact before Related results in flat rows, and closes back to the prior position. Capture opens a distinct full-screen explicit-save surface rather than Eve chat: one typed or dictated input, optional attachment controls, and a visible Save action. Successful routing shows a compact destination-and-grounding confirmation with `Change` and safe `Undo`; the surface remains open only for consequential clarification or correction, then returns to its invoking context.
- Overlay headers use a consistent labelled back action and restore focus to the invoking control. Phone interactions require no swipe or precision gesture, preserve locally entered text through safe navigation and transient failure, keep primary actions reachable above the keyboard, and retain the complete flow at 200% text size without horizontal scrolling. Loading, empty, offline, authentication, app-server, and Eve-only failures preserve this hierarchy and replace unavailable content with the honest next action rather than collapsing into a generic dashboard state.
- Prototype commit `8a676a5` is the primary visual and interaction evidence for this decision; its selected `S` variant combines the shaded top region, explicit composer, and flat Personal Ledger shortlist, while its A/B/C variants preserve the rejected structural alternatives. It is throwaway planning code, not an implementation seed: Phase Seven implementation should reproduce this contract with production data, owner-scoped functions, tests, and existing design-system primitives rather than promote the prototype route.

PWA and mobile platform contract:

- Phase Seven treats current iOS Safari and an iOS Home Screen web app as the reference private-beta experience. Current Android Chrome and its installable PWA remain supported for the same core flows where practical, but Android parity must not prevent a useful iOS-only progressive enhancement. Ordinary supported mobile browsers retain Today, Eve, capture, search, and durable writes; installation is not an artificial product gate and adds the standalone shell plus capabilities the platform itself requires, including iOS Web Push.
- A normal home-screen launch opens Today with its Eve composer immediately available and the persistent Capture action reachable without navigation. A notification or saved deep link opens its intended record or surface, and an authentication interruption returns the owner to that destination after sign-in rather than discarding the intent.
- The installed app may cache only the versioned static assets needed to launch a branded shell and explain connection loss. Today data, Eve, authentication, and every durable read or write remain network-required: the app does not present stale Today data as current, accept an offline mutation, or queue a capture for later synchronization. Offline startup provides an honest connection-required state with retry, while any already-entered text remains available to retry or copy.
- Each Eve or Capture composer may keep one unsynced device-local draft for its surface through navigation, reload, app suspension, transient restart, or an update reload. A draft is not a Source Record or proof of capture, is never synchronized, is visibly restored as unsaved, expires after 24 hours, and clears after successful submission, explicit discard, or sign-out.
- Phone layouts remain single-column in portrait and landscape, with no horizontal scrolling or desktop-density substitution. Navigation, the composer, fixed controls, dialogs, and toasts respect every safe-area inset and the software-keyboard viewport; primary actions remain reachable without precision gestures, and interactive targets are at least 44 by 44 CSS pixels. Tablet and desktop layouts may progressively add columns or persistent navigation without changing the complete phone flow.
- The complete Phase Seven path meets WCAG 2.2 AA. Capture, Today, recovery, navigation, and approval controls work with VoiceOver, TalkBack, and keyboards; focus order and restoration are explicit; state is never conveyed by color alone; loading and errors are announced without stealing focus; system light/dark and reduced-motion preferences are honored; and 200% text resizing preserves content and actions without horizontal page scrolling. A defect that blocks capture, Today, or recovery for these modes blocks release.
- Cold startup renders the standalone shell, composer, and content-shaped Today loading state without waiting for Eve. Authoritative Today candidates appear when app data arrives, while Eve ranking and natural-language explanations enhance them progressively. Supported mobile performance targets the 75th-percentile good Core Web Vitals thresholds: LCP at or below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below 0.1.
- Failure states distinguish no connection, expired authentication, app-server failure, and Eve-only failure and always expose the safe next action. When authoritative app data is reachable but Eve is not, Today uses its deterministic ordering and explanations and direct structured actions remain available where their server policy can execute safely; capture that depends on Eve routing stays visibly unsaved with its draft, retry, and copy controls.
- A service worker may fetch a new version in the background but does not force-refresh an active session. The app adopts it at the next safe navigation or relaunch; an update that truly needs an immediate reload presents a quiet action and preserves every unfinished draft first. Cache or version incompatibility degrades to a recoverable refresh state rather than a blank or partially interactive shell.

Explicit reminder push contract:

- Phase Seven may generate one push alert for an open Follow-Up, an open dated one-time General Action, the current occurrence of an active Routine, or an active Saved Item with an explicit bring-back date only after the owner deliberately creates or accepts that record. Pending suggestions, inferred candidates, Birthdays, Calendar context, review items, ordinary Today resurfacing, and deferred-only Actions remain ineligible. Completed, dismissed, archived, paused, deferred, rescheduled, or otherwise ineligible state suppresses the pending alert, and the dispatcher reloads current owner scope, visibility, lifecycle, Reminder Schedule, and installation consent before sending.
- Visibility never enrolls another person in ambient delivery. A shared record alerts only the owner who explicitly created or accepted that reminder; another member may see the record where scope allows but receives no push merely because it is visible. Rich shared assignment and household reminder coordination remain Phase Eight work.
- Every eligible record occurrence has at most one Reminder Schedule, distinct from its domain due date or bring-back date. A date-only record visibly proposes 9:00 AM in the timezone captured with the schedule. The owner may instead choose an exact local time or one relative lead, such as at the due time, one hour before, one day before, or a custom earlier moment. Phase Seven does not support multiple alerts, escalation, repeated nagging, or a per-record push toggle.
- A Routine stores one relative Reminder Schedule rule and materializes it for each occurrence; a one-time record materializes one concrete alert moment. Editing the due date, bring-back date, timezone, recurrence, or Reminder Schedule invalidates the old pending intent and deterministically creates its replacement. If a selected lead time has already passed when the record is created or accepted, Tendnote saves the record without firing an immediate catch-up push, then visibly offers the next valid future time while Today remains authoritative.
- Structured creation shows the proposed reminder time inline with easy alternatives rather than forcing an extra step. Conversational capture saves first, confirms the concrete time, and offers an immediate `Change` action; it asks a blocking timing question only when the request is genuinely ambiguous or impossible. The default therefore never hides, but capture remains fast.
- A Birthday remains a person fact and never notifies by itself. Adding one may offer `Add birthday reminder`, which creates an explicit annual Follow-Up with day-of, one-week-before, or custom Reminder Schedule timing. This supports message and gift-preparation intent without inferring closeness or introducing Phase Eight birthday-planning automation.
- A notification carries one canonical deep link and no complete, snooze, dismiss, or other mutation action. Operating-system dismissal changes no Tendnote state. Current authentication, ownership, visibility, sensitivity, lifecycle, and schedule are revalidated before rendering or delivery; failures and stale suppression leave the backing record available through Today without a catch-up-alert card.
- Phase Seven adds no AI-inferred alerts, silent push, birthday auto-alerts, collaborator auto-enrollment, quick mutation actions, notification center, marketing notifications, or exact-delivery promise.

Reminder opt-in contract:

- Tendnote first offers Reminder Opt-In on an installation immediately after the owner successfully creates or accepts its first notification-eligible time-bound record there. The saved record and its normal confirmation come first; the invitation is a calm inline continuation, never a first-load prompt, modal interruption, banner, warning badge, or condition of saving. Reminder settings remain discoverable before this earned moment.
- The pre-permission step says that Tendnote can alert the owner on this installation at the times they choose, that Reminder Previews are generic by default, that delivery is best effort, and that reminders can be turned off at any time. It offers `Enable reminders` and `Not now`; only a direct `Enable reminders` action may invoke browser or operating-system permission.
- Choosing `Not now` or dismissing a browser permission prompt suppresses contextual invitations on that installation for 30 days. Afterward Tendnote may offer once more only after the owner creates or accepts another eligible record. A denied permission is never prompted contextually again: settings show reminders as blocked, explain that the owner must restore permission through browser or operating-system settings, and expose `Check again` only as an owner-initiated action.
- On iOS Safari, the earned invitation explains that reminders require adding Tendnote to the Home Screen and gives short Safari-specific instructions; it never presents a fake install button or requests notification permission in the browser tab. When the owner later opens Tendnote in standalone mode, the app offers the normal inline opt-in once, and iOS permission appears only after another direct `Enable reminders` action. If the owner never installs, the authoritative record remains available through Today without push.
- A supported Android browser can enable reminders directly without installation; PWA installation remains optional and separate from permission. Unsupported or restricted contexts omit the permission action, state that reminders are unavailable in this browser, and point to Today as the reliable source. If permission succeeds but subscription registration fails, Tendnote says reminders are not enabled, preserves the saved record, and offers an explicit `Try again`; permission alone never counts as successful opt-in.
- Successful Reminder Opt-In covers every notification-eligible record the owner can see on that installation after deliberately creating or accepting it. Phase Seven does not add per-record push toggles or a notification-preference matrix; the backing record's Reminder Schedule and lifecycle remain the controls, and an inferred suggestion cannot notify until the owner accepts it into an active time-bound record.
- `Turn off reminders on this device` immediately unsubscribes and disables the current Reminder Installation and suppresses its pending attempts. Tendnote does not claim to revoke browser or operating-system permission. Settings show that reminders are off and offer `Enable again`; re-enabling always requires fresh explicit opt-in and invokes platform permission only when it is no longer granted. Remote revocation of another labelled installation follows the cross-installation delivery contract.

Reminder preview privacy contract:

- Every new device subscription uses a generic Reminder Preview by default. The owner may explicitly enable detailed previews only from an authenticated session on that device; ordinary session authentication plus the direct on-device action is sufficient, and Tendnote does not imply that a web app can enforce an additional native biometric or password gate. Signing out disables the device subscription rather than leaving ambient delivery attached to a former session.
- A detailed Reminder Preview may show only a concise record title or person-facing reminder label and the scheduled time, such as `Call Mara — 6:00 PM`. It never includes note bodies, source excerpts, attachments, AI explanations, visibility metadata, or other record summary content. Generic copy identifies Tendnote and asks the owner to open the app without exposing the record.
- The per-device preference grants presentation permission, not broader data authority. Sensitivity and proactive-visibility policy are checked when rendering every notification and force generic copy when detail is not safe. Eligible private and shared records otherwise follow the same rules; visibility alone neither grants detail nor forces generic copy.
- Tapping a notification opens only the canonical Tendnote record or reminder occurrence and never completes, snoozes, dismisses, or otherwise mutates it. Tendnote revalidates authentication, ownership, visibility, sensitivity, and current lifecycle before rendering, preserves the intended destination through sign-in, and shows a calm non-leaking unavailable or resolved state when the record can no longer be opened. Deep links carry stable identity rather than copied record content or an action-bearing token.

Reminder freshness and stale-delivery contract:

- Every notification intent has an intended notification time and a bounded Reminder Freshness Window measured from that time, never from a delayed dispatcher or retry. An explicitly timed Follow-Up, one-time General Action, Routine occurrence, or Saved Item alert may arrive at most one hour late. A date-only reminder remains fresh only through the end of its occurrence's local calendar day; a dated Saved Item follows that date-level rule unless the owner explicitly chose a time.
- The local-day boundary comes from the timezone attached to the reminder occurrence: a Routine uses its recurrence timezone, while another date-only record uses the owner timezone captured when its notification intent is scheduled. Changing the relevant timezone invalidates and regenerates the pending intent rather than reinterpreting an already queued alert across travel or daylight-saving changes.
- Domain lifecycle may shorten but never extend the freshness window. Follow-Ups and one-time General Actions stop notifying when completed, dismissed, snoozed, rescheduled, or archived. A Routine occurrence stops when completed, skipped, superseded by its next occurrence, or when the Routine is paused or archived. A Saved Item stops when archived or when its bring-back date is cleared or moved. The dispatcher reloads and revalidates the authoritative owner-scoped record immediately before every send.
- Transient failures may retry only inside the original freshness window. Delivery uses one idempotent notification intent per record occurrence and Reminder Installation so duplicate dispatcher runs do not create duplicate alerts; the provider accepting a request records an accepted attempt, not proof of display. Any still-pending attempt becomes `suppressed_stale` when freshness expires, and its Web Push TTL never exceeds the remaining window.
- Stale suppression is delivery state only. It never completes, dismisses, snoozes, reschedules, archives, applies Today feedback, or otherwise mutates the backing record. Today independently reloads authoritative state and may continue to show an eligible overdue Follow-Up or General Action, current missed Routine occurrence, or arrived Saved Item with its ordinary factual `why today` reason. Opening Today does not generate a catch-up alert or a separate missed-notification card.

Reminder delivery across installations:

- Each reminder occurrence fans out to every currently opted-in Reminder Installation. Tendnote does not select a preferred device, infer physical-device identity, fail over between devices, or synchronize whether an alert was displayed. Explicit opt-in makes each browser or installed PWA registration an intended delivery target.
- A Reminder Installation is an owner-scoped server identity for one browser or installed PWA registration, not a fingerprint of its physical hardware. It carries its current push endpoint and keys, generic-or-detailed preview preference, enabled or disabled lifecycle, and an optional owner-readable label. Separate browser profiles or installations on one physical device may remain separate targets. When the authenticated client still presents the known installation identity, endpoint rotation updates that installation; otherwise a replacement registers separately and terminal obsolete endpoints are pruned.
- The idempotency boundary remains one notification intent per record occurrence and Reminder Installation. Dispatcher re-entry or provider retry reuses that target intent and cannot create a second alert attempt stream for the same occurrence-installation pair.
- Delivery is isolated per installation. A transient failure retries only that installation inside the original Reminder Freshness Window; a terminal provider response disables only that subscription immediately. Failure, retry, acceptance, suppression, or revocation for one installation never delays, cancels, or re-routes another installation's attempt. Provider acceptance means accepted for delivery, not displayed.
- The owner may disable reminders from the installation itself or revoke a labeled installation remotely from an authenticated settings view; signing out disables the current installation. Revocation immediately suppresses its pending attempts and excludes it from future occurrences. Re-enabling requires a fresh explicit opt-in on that installation, and any late notification deep link still passes current authentication, ownership, visibility, sensitivity, and lifecycle checks.
- Audit one coarse delivery trail per occurrence-installation target: intended time, installation identity, attempt timestamps and count, and outcomes such as accepted, transient failure, terminal endpoint, suppressed stale, or suppressed revoked. Do not retain rendered Reminder Preview text, encryption keys, full endpoints, or any claim that the device displayed the notification.

Implementation handoff boundaries:

These are dependency boundaries for the separate implementation-ticket pass, not build tickets created by this specification map. That pass should preserve complete meaningful delivery slices rather than split schema, adapters, policy, product behavior, and verification into unrelated ticket chains.

1. Establish the Phase Seven domain and persistence foundation: Saved Items and promotion links, Today-only feedback, Reminder Schedules, Reminder Installations, occurrence-installation intents, minimized audit, and the owner-scoped query and mutation seams that make later surfaces safe.
2. Establish shared typed product functions and Agent Capabilities for capture routing, Today candidates and curation, and Global Recall. Deterministic policy, authoritative record reloads, grounding, approval gates, capability fallbacks, and thin Eve/web adapters ship together with their tests.
3. Replace the current phone shell with the iOS-reference, online-required PWA foundation: installability, `Today / Search / Capture / Review / Menu`, focused full-screen flows, safe areas, software-keyboard behavior, one visibly unsaved local draft per composer, honest failure states, and safe update adoption. Preserve supported mobile-browser access and do not gate core use on installation.
4. Deliver explicit Capture end to end across supported destinations, including save-first Pending Source Records, consequential clarification, grouped outcomes, Saved Item fallback, correction and safe undo, person resolution, source grounding, and existing review-gated Asset behavior.
5. Deliver Global Recall end to end across the typed result families, including exact and semantic candidate paths, permission-first merging, stable ranking and diversity, canonical deep links, grounded Eve answers, restricted-record handling, and the mobile Search overlay.
6. Deliver Today end to end over authoritative cross-domain candidates, including deterministic eligibility and mandatory overflow, bounded Eve ranking and explanation, stable refresh behavior, the three-to-five-item Personal Ledger UI, domain actions, and Today-only `Later` and `Not today` feedback.
7. Deliver explicit reminder push only after the PWA, scheduling, lifecycle, and authoritative Today foundations exist: earned installation-scoped opt-in, privacy-gated previews, per-installation fan-out, freshness suppression, revocation, best-effort delivery, and Today recovery.
8. Close Phase Seven with the cross-domain proof journey and the full acceptance/eval matrix below, including supported-device and accessibility evidence. No slice is complete if it bypasses owner scope, source grounding, review gates, or deterministic fallback in order to demonstrate its UI.

Proof scenario:

- Extend the refrigerator-water-filter storyline from Phases Five and Six. From the iOS-reference mobile experience, the owner explicitly captures that the kitchen refrigerator needs a replacement filter next month, asks for an alert one week before, and saves an open question about where to buy it. One grounded capture produces only the explicitly requested outcomes: an Asset-linked General Action with one visible Reminder Schedule and a private Saved Item with `bringBackAt`; a newly inferred filter fact or evidence still enters the existing Asset review path.
- The first eligible record is saved before Tendnote calmly offers installation-scoped Reminder Opt-In. Generic preview remains the default. When the relevant day arrives, Today shows a factual, capped cross-domain shortlist containing the due or resurfaced records without inventing priority; `Later` and `Not today` affect only Today. A stale or failed push never mutates the records, and authoritative state remains recoverable in Today.
- The owner can ask Eve or Search, "What filter does the fridge need, and what am I doing about it?" Global Recall returns permission-filtered Asset Memory, General Action, and Saved Item results with Exact before Related, canonical references, grounding, and deep links. Eve cites only those records and states what remains unresolved. Correction, archive or promotion, sign-out, revoked installation, offline capture failure, and an Eve-only failure all preserve the contracts above.
- This is the primary implementation proof because it crosses Capture, review, Assets, Actions, Saved Items, Today, Reminder delivery, Search, and Eve without inventing a new domain. People, Follow-Ups, Calendar, mixed visibility, and restricted records remain mandatory matrix fixtures rather than being forced unnaturally into the demonstration story.

Acceptance and eval matrix:

| Evidence layer | Required release evidence |
|---|---|
| Deterministic policy and integration tests | Prove owner and visibility scope, lifecycle and sensitivity gates, explicit-versus-inferred routing authority, source linkage, idempotent correction/promotion, Today eligibility/caps/feedback, exact-before-related retrieval, Reminder Schedule invalidation, per-installation fan-out, freshness suppression, revocation, audit minimization, and non-leaking inaccessible records. These tests are the security and mutation boundary; model evals cannot substitute for them. |
| Eve evals | Exercise explicit and ambiguous capture, multi-outcome restraint, Saved Item fallback, person ambiguity, Today ranking only inside validated candidates, factual `why today` explanations, grounded cross-domain answers and citations, restricted-record restraint, weak-recall limitations, and refusal to create inferred writes or alerts. Fast deterministic evals gate normal CI; judge-backed quality and model comparisons remain explicit and credential-gated. |
| Browser and accessibility tests | Cover the complete phone flows for Today, Search, Capture, Review, active Eve, settings, reminder opt-in, correction, failure recovery, and canonical return navigation. Verify 44-by-44 CSS-pixel targets, safe areas and keyboard viewport, focus order/restoration, screen-reader announcements, full keyboard operation, 200% text without horizontal page scrolling, contrast, state not conveyed by color alone, and reduced motion. |
| Manual supported-device checks | On current supported iOS Safari plus installed Home Screen PWA and at least one supported Android browser/PWA, verify installation guidance, permission timing, generic and detailed preview policy, deep links through authentication, multi-installation fan-out, disable/re-enable and remote revocation, endpoint rotation or terminal failure, stale suppression, local-draft restoration/expiry/clearing, safe application updates, and honest unsupported-browser behavior. Record provider acceptance only as acceptance, never proof of display. |

The separate implementation-ticket pass is ready to begin only when every contract above maps to a handoff boundary and at least one verification layer, the proof journey can be implemented without inventing product policy, and all remaining work is execution rather than an unresolved Phase Seven decision.

#### Phase 8: Rich Household and Multi-Domain Collaboration

Goal: Build the richer household product workflows on top of the Phase 4 scope foundation and the first Personal OS vertical.

Deliverables:

- Shared household reminders and planning surfaces beyond the minimal foundation
- Household gift ideas and birthday planning
- Family and social event tracking
- Household-aware strategist behavior
- Shared views over supported Personal OS domains where permissions allow

Vertical slice issue seeds:

- Build shared household reminders page.
- Add household gift ideas and birthday planning view.
- Add family and social event tracking.
- Add household-aware strategist behavior.
- Add shared views across supported non-people domains where scope rules allow.

#### Future Personal OS Domains

These domains are intentionally not fully sequenced yet. Phase 5 and Phase 6 should preserve enough architectural room for them by keeping source records as evidence, memories as reviewed durable claims, snapshots as rebuildable caches, retrieval results typed, reminders/actions lifecycle-based, provider data minimized, and durable writes review-gated.

Candidate future domains:

- Career memory / brag document for work evidence, wins, metrics, promotion packets, resume bullets, and interview stories
- Personal knowledge notebook / library for notes, journal entries, quotes, book highlights, pictures, ideas, and saved snippets
- Goals, habits, routines, and reflection, keeping routines distinct from reminders/actions
- Decision journal for options, rationale, assumptions, outcomes, and review reminders
- Broader Personal OS dashboard behavior as more domains become real

Do not introduce a giant generic subject abstraction until a concrete second durable domain needs it. Prefer staged generalization from real verticals, link tables over overloaded records, and domain-specific behavior where it earns its keep.

#### Phase 9: Productization or Open Source

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
