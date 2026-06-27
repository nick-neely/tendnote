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

Nick and Juli use Tendnote for shared social context, family events, gift ideas, household reminders, and shared contacts while keeping private notes scoped to the correct person.

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

As a user, I want shared context with my girlfriend so that we can remember family events, gifts, and social commitments together.

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
| `update_followup_status` | 1E | Complete, dismiss, snooze, or reopen follow-ups after manual follow-ups exist. |
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
| `shared-household-context.md` | Later Phase 3 skill for Nick and Juli shared context after scope enforcement exists. |

### Schedules

| Schedule | Phase | Behavior |
|---|---|---|
| Daily brief | 1F | Runs every morning and suggests 1 to 3 relationship actions. |
| Weekly relationship review | 1F | Reviews stale contacts, overdue follow-ups, and missed birthdays after the daily brief model works. |
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
| Background agent work | Postgres-owned jobs triggered by local inline processing, Cron, Vercel Queues, Eve schedules, or Vercel Workflows depending on workflow shape |
| Email | Resend for app/system emails, Gmail integration later for drafts |
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
| Phase 1D | pgvector semantic retrieval | Add memory embeddings for fuzzy queries like gift ideas, career updates, stressful life events, or people worth checking in with. |

Agent retrieval should be hybrid:

- Use deterministic SQL for known-person context, birthdays, due follow-ups, pinned memories, and recent source records.
- Use full-text search for exact recall like names, companies, places, or specific phrases.
- Use pgvector later for fuzzy or semantic recall.
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
  status                # queued, processing, completed, failed, skipped
  attempts
  last_error
  idempotency_key
  run_after
  created_at
  updated_at

memory_embeddings       # Phase 1D
  memory_id
  embedding
  embedding_model
  embedding_version
  embedded_text
  created_at

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
- **Brief**: Tendnote can generate a small persisted daily brief from reviewed context and due follow-ups.
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
- Plain Postgres retrieval first, then context snapshots, Eve-backed web chat, full-text search, pgvector, follow-ups, briefs, and drafting as follow-on slices

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
- Keep extraction job state in Postgres. Local development may trigger processing inline after enqueue; production hardening should add a Vercel Queue or Cron trigger that carries extraction job ids and calls the same shared processor.
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

- Add `memory_embeddings` for approved memories and selected source summaries.
- Use pgvector for fuzzy retrieval, gift ideas, life-event themes, career updates, and "who should I check in with" style prompts.
- Do not block the initial usable MVP on embeddings. Add this after plain retrieval and snapshots work.

##### Phase 1E: Manual Follow-Ups Through Eve

- Add the manual follow-up lifecycle for person-linked reminders: create, complete, dismiss, snooze, reopen, and edit.
- Add Eve tools for follow-up creation and status changes only after shared owner-scoped follow-up mutations and audit logging exist.
- Treat user-created follow-ups as active reminders and agent-suggested follow-ups as separate reviewable proposals. Do not let Eve silently turn suggestions into active reminders.
- Keep follow-ups personal and private in Phase 1; do not add Calendar-derived follow-ups or shared household reminders yet.
- Make due follow-ups visible on person profiles and the dashboard so the later brief has real action items to summarize.

##### Phase 1F: Persisted Daily Brief

- Generate persisted daily brief records with stable child items, source references, statuses, and dismiss/snooze behavior.
- Keep the first daily brief small: default to 1 to 3 items from due follow-ups, birthdays already stored in Tendnote, reviewed memories, recent source records, and retrieval signals.
- Use the Phase 1 retrieval stack in order: relational context, snapshots, full-text search, and semantic retrieval when available.
- Add the Eve schedule only when brief generation is real. Do not keep placeholder schedules in the active agent tree.
- Keep suggested follow-ups reviewable. A brief may propose an action, but accepting it should create or update the underlying follow-up record.
- Add weekly relationship review only after the daily brief model works; it should reuse the same persisted brief-item shape instead of introducing a parallel review artifact.

##### Phase 1G: Tendnote-Only Message Drafting

- Add message drafting inside Tendnote after the capture, review, retrieval, follow-up, and brief loop is working.
- Drafts should use approved memories as facts, source records as source-grounded context, and suggested memories only as clearly tentative hints.
- Add `draft_message` and `create_message_draft` only for Tendnote-owned draft records. Do not create Gmail drafts, send messages, or write to external systems in Phase 1.
- Every draft should be reviewable, editable, dismissible, and source-grounded. The user remains responsible for copying or sending outside Tendnote.
- Add tone, no-fake-memory, source-grounded-drafting, and no-send-without-approval eval coverage before treating drafting as complete.

Vertical slice issue seeds:

- Implement add person and search people flows through UI and agent tool.
- Implement source records and atomic memories with `suggested`, `approved`, `dismissed`, and `archived` states.
- Implement add memory flow with source, sensitivity, confidence, importance, status, and scope.
- Implement person context snapshot generation and snapshot-backed `get_person_profile`.
- Implement Eve-backed web chat with people search, explicit person creation, source-record capture, explicit memory capture, and review component rendering.
- Add a production background trigger for extraction jobs before relying on deployed capture at real volume. Prefer Vercel Queues for event-driven extraction retries and observability; use Vercel Workflows only if extraction becomes a multi-step orchestration.
- Add full-text search over people, memories, and source records.
- Add pgvector embeddings and semantic memory search as a later Phase 1 issue.
- Implement create follow-up flow with complete, snooze, and dismiss actions.
- Implement daily brief schedule that returns up to 3 items.
- Implement draft message tool and draft review UI.
- Add evals for no-fake-memory, tone-match, source-grounded-recall, and brief-size-limit.

#### Phase 2: Google Integrations

Goal: Reduce manual entry by adding safe, preview-first integrations.

Deliverables:

- Google Contacts import preview
- Duplicate detection preview
- Google Calendar read integration
- Birthday and upcoming event prompts
- Post-meeting follow-up suggestions
- Gmail draft creation after approval

Vertical slice issue seeds:

- Add Google Contacts connection and import preview screen.
- Add duplicate candidate matching with manual confirmation.
- Add Calendar read connection and upcoming event context panel.
- Add post-meeting follow-up candidate schedule.
- Add Gmail draft creation behind explicit approval.
- Add privacy evals around calendar and email-derived context.

#### Phase 3: Shared Household Context

Goal: Support Nick and Juli shared context without leaking private notes.

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
14. Add pgvector semantic memory retrieval.
15. Add manual follow-up creation and status updates through UI and Eve.
16. Add persisted daily brief generation and schedule.
17. Add Tendnote-only draft message tool and draft review UI.
18. Add no-send-without-approval eval.
19. Add no-fake-memory eval.

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
