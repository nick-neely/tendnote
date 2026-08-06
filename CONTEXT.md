# Tendnote

Tendnote is a personal relationship memory and follow-up assistant. Its language should preserve a private, consent-first relationship notebook model rather than a sales CRM model.

## Language

**Observation**:
Agent-inferred, low-trust relationship context that is reviewable and disposable. An observation can be used to ask whether something should be saved, but it is not durable truth.
_Avoid_: Automatic memory, inferred fact

**Memory**:
User-approved or strongly user-confirmed durable relationship context about a person. A memory can be used later for recall, follow-up suggestions, and message drafting according to its sensitivity and scope.
_Avoid_: Observation, raw note, profile fact

**Context Fact**:
A concise, categorized natural-language orienting statement whose subject is either a Tendnote user or a Household Workspace. A context fact is independently correctable and does not replace a typed operational setting or a more specific domain record.
_Avoid_: Profile field, instruction, biography entry, generic memory

**Self Context**:
Small, independently correctable, broadly reusable orienting facts a Tendnote user explicitly saved or accepted about themselves, such as their work, background, interests, or durable preferences. Self context is private by default and remains about that user when deliberately shared; it does not replace a more specific Tendnote domain and is not relationship memory, a biography, or an inferred persona.
_Avoid_: Self memory, user profile, persona, account metadata

**Household Context**:
Small, independently correctable, broadly reusable orienting facts active Household Members jointly maintain about the Household Workspace as a whole, such as where the household lives or a durable shared preference. Household context is visible to every active Household Member; it does not replace a more specific Tendnote domain and is not a member's self context, a private note about the household, a household biography, or a collection of members' private facts.
_Avoid_: Household memory, shared self context, household profile

**Suggested Context Fact**:
An agent-proposed Self Context or Household Context fact grounded in specific user-visible evidence and requiring review before it becomes trusted durable context. A suggested context fact is not available to Eve as established context until a user accepts it.
_Avoid_: Inferred profile, automatic context, observation

**Orientation Context**:
The bounded set of active, policy-eligible Self Context for the current user and Household Context for their Household Workspace that helps Eve understand who it is assisting from the start of a turn. Restricted facts require direct relevant intent instead of automatic inclusion, and orientation context may softly inform an answer but cannot change product policy or authority; it is a read of authoritative Context Facts, not personalized base instructions, another member's private context, or a generated source of truth.
_Avoid_: User prompt, profile snapshot, inferred persona, chat memory

**Source Record**:
The canonical evidence record for logged context, such as a manual note, interaction summary, import preview, calendar event summary, or future email summary. Source records can ground suggestions when phrased as "you noted", "you logged", or "you mentioned", but they are not the same as durable memories.
_Avoid_: Memory, confirmed fact, inferred fact

**Retained Content**:
The minimized source record text Tendnote keeps for retrieval, grounding, and review. Retained content should be enough to explain the context without preserving unnecessary raw provider data.
_Avoid_: Raw dump, full transcript

**Pending Source Record**:
A source record captured before Tendnote has resolved its person, destination, or another consequential field needed for the intended outcome. Pending source records can appear in review, but should not feed normal profiles, briefs, or drafts until resolved.
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

**Global Recall**:
An owner-scoped federated read capability shared by Eve and structured search that returns typed, permission-filtered Exact and Related results across supported Tendnote domains with canonical record references, grounding, and deep links. Global recall finds existing visible records; it does not create importance, expose raw evidence as its own result family, or turn generated prose into retrieval truth.
_Avoid_: Chat history search, recommendation feed, generated answer store, universal database search

**Relationship Agenda**:
A read-only, cross-person view of existing upcoming or review-worthy relationship context for a time window. A relationship agenda can help Eve answer broad questions, but it is not a suggestion generator, follow-up creator, or persisted brief.
_Avoid_: Generated task list, background scanner, daily brief

**Follow-Up**:
A user-visible reminder to reconnect with a person for a specific reason at a specific time or cadence.
_Avoid_: Task, deal, lead activity

**Reminder Schedule**:
The single owner-chosen alert moment for one eligible record occurrence, expressed as an exact local time or one lead time relative to the record's due or bring-back time. It controls ambient delivery without changing when the backing record is actually due.
_Avoid_: Due date, notification preference, alarm sequence

**Reminder Preview**:
The ambient notification copy for an eligible explicit time-bound record. A reminder preview is generic by default on each device; an explicitly trusted device may show a bounded title and scheduled time only when the record's sensitivity and proactive-visibility policy allow it.
_Avoid_: Notification body, record summary, lock-screen note

**Reminder Freshness Window**:
The bounded interval after an intended notification time during which its alert is still useful enough to deliver. Expiry suppresses only the stale alert; it never resolves, defers, or hides the authoritative record.
_Avoid_: Retry window, reminder expiry, overdue grace period

**Reminder Installation**:
One owner-scoped browser or installed PWA registration that has explicitly opted into reminder delivery. Each installation is an independent delivery target with its own subscription lifecycle and preview preference; it identifies a browser installation, not inferred physical hardware.
_Avoid_: Physical device, preferred device, fingerprint

**Reminder Opt-In**:
The explicit, installation-scoped consent that lets Tendnote alert an owner about notification-eligible records they deliberately created or accepted. Reminder opt-in is offered only after its value is concrete, remains distinct from browser permission, and never activates inferred suggestions or a broader notification-preference system.
_Avoid_: Notification onboarding, account-wide permission, automatic alerts

**General Action**:
A non-person action or reminder for the owner's broader Personal OS context, such as replacing a water filter or renewing a subscription. A general action has its own domain model with source grounding, lifecycle state, due dates or cadence, visibility scope, optional person links, and later links to assets; product UI may label one-time general actions as Actions and recurring general actions as Routines.
_Avoid_: Follow-up, task, project, todo

**Suggested General Action**:
A review-gated proposal for a non-person General Action, grounded in a source record or other visible Tendnote context. A suggested general action can be accepted, edited, dismissed, or ignored before it becomes an active General Action.
_Avoid_: Automatic task, inferred todo, suggested follow-up

**Saved Item**:
An owner- or household-scoped, source-grounded note, link, or open question that Eve keeps when an explicit capture has no better supported destination. A saved item is private by default, may have a date to bring it back, follows an active/archive lifecycle, and may resolve into linked domain records, but it is not a task, project, tag, document inbox, or replacement for a person, General Action, or Asset.
_Avoid_: Inbox item, generic record, task, bookmark collection

**Capture Outcome**:
A domain record or review artifact produced from one explicit typed or dictated capture. One capture may have multiple explicitly requested outcomes, while outcomes inferred beyond the owner's instruction remain review-gated.
_Avoid_: Parsed intent, agent action, capture result

**Asset**:
A practical owner- or household-scoped thing Tendnote tracks over time — an appliance, vehicle, subscription, service, property, or kept item — with a fixed kind, visibility scope, active/archive lifecycle, and internal audit trail; Asset Memories, evidence, and links attach to it in later Phase 6 slices. An asset is never a person, project, document library, or generic object.
_Avoid_: Person, project, document, inventory item, financial asset

**Area**:
A broad life category used to organize General Actions, such as Home, Health, Finance, Travel, Admin, or Career. An area is not a project, tag, folder tree, permission scope, or household workspace.
_Avoid_: Project, tag, folder, scope

**Suggested Follow-Up**:
An agent-proposed follow-up that the user can accept, dismiss, or ignore before it becomes a normal reminder. Suggested follow-ups may appear as review prompts or low-weight brief items, but they are not the same as user-created follow-ups.
_Avoid_: Automatic task, open reminder

**Review Queue**:
A lightweight place to find unresolved source records, suggested memories, and suggested follow-ups. The review queue is an entry point, not the main product metaphor.
_Avoid_: Task inbox, pipeline, work queue

**Assistant Surface**:
The conversational Tendnote interface where the assistant can respond with natural language and structured components for reviewing memories, source records, follow-ups, briefs, or drafts.
_Avoid_: Raw chatbot, task manager

**Agent-Backed Surface**:
A purpose-built Tendnote interface that shares Eve's owner-scoped product functions, grounding, audit, and approval policy while presenting controls and results suited to its task. Deterministic policy owns eligibility and caps; the surface calls product functions directly for structured intent and limits agent reasoning to interpretation, generation, semantic retrieval, or ranking and explanation within a validated candidate set.
_Avoid_: Chat-only UI, autonomous workflow, client-side agent policy

**Agent Capability**:
A named, owner-scoped operation with a typed input and output that may use agent reasoning while leaving product policy authoritative; Eve and Agent-Backed Surfaces reach it through thin channel adapters rather than hidden chat turns. Read-only results may remain ephemeral when they carry authoritative record references, source grounding, and trust metadata, but actionable, reviewable, or reloadable output must first become a persisted domain or review artifact.
_Avoid_: Hidden prompt workflow, UI agent, chat simulation

**Today**:
The owner's capped cross-domain mobile home shortlist of visible, currently eligible record references. Today may use ephemeral Eve curation inside deterministic policy, but it is not a persisted brief, task backlog, priority queue, or source of truth.
_Avoid_: Daily Brief, task inbox, backlog, generated priority list

**Daily Brief**:
A small set of relationship suggestions for today. It should stay capped and useful rather than becoming a task feed.
_Avoid_: Pipeline, queue, inbox

**Weekly Relationship Review**:
A broader periodic brief for stale contacts, overdue follow-ups, missed birthdays, and lower-priority relationship context. It uses the same persisted brief-item model as the daily brief rather than a separate queue.
_Avoid_: Task feed, backlog, separate review system

**Message Draft**:
A private, Tendnote-owned draft of a message to a person, grounded in relationship context and persisted with the source references that informed it. Drafts stay inside Tendnote — the user reviews, edits, copies, dismisses, approves internally, or marks them sent manually — and approving is internal readiness only, never an external send or draft.
_Avoid_: Outbox, campaign, automatic send, external draft

**External Draft Recipient**:
An action-specific recipient address used when Tendnote creates an external provider draft from an approved message draft. It may come from a saved person contact method or from explicit user input for that draft action, but it is not automatically a durable person contact method.
_Avoid_: Imported contact, inferred email, synced address book entry

**Contact Import Preview**:
A lightweight review surface for proposed Google Contacts changes before Tendnote writes people, birthdays, or contact methods. It should feel like confirming sensible suggestions, not processing a ledger of every provider record.
_Avoid_: Contact sync, address book mirror, import ledger

**Contact Import Candidate**:
A proposed contact import outcome that the user can confirm, skip, or resolve before it changes Tendnote relationship data.
_Avoid_: Synced contact, automatic person, imported truth

**Candidate Decisions**:
The authoritative set of manual-resolution choices the Contact Import workflow allows for one candidate — which people it may attach to, whether the owner must choose among them, whether a new person may be created, and whether a birthday conflict must be resolved. The review UI presents exactly these decisions; it never re-derives eligibility, so the workflow and the UI cannot drift.
_Avoid_: Client eligibility rules, UI policy, computed affordances

**Candidate Fingerprint**:
A stable digest of the decision-relevant state a Contact Import Candidate was reviewed against (identity, the fields that would be written, its match, and its candidate decisions). Confirmation carries the fingerprint back, and apply refuses the row as stale if a fresh provider response drifted from it — so a changed provider record can never silently change a confirmed outcome.
_Avoid_: Version number, etag, content hash of the raw provider record

**Private Beta Access**:
The account-level gate that decides whether a signed-up user may enter Tendnote during the early hosted product phase. It controls product access only; it is not the same as relationship data ownership, integration authorization, or payment status.
_Avoid_: Public signup, environment allowlist, owner scope

**Authenticated App Shell**:
The recognizable Tendnote navigation and layout frame available only after Better Auth and Private Beta Access admit an owner. It contains no relationship records, Today or Eve content, or other owner-specific data.
_Avoid_: Public app shell, dashboard data, owner cache

**Instant Interaction**:
An admitted primary navigation that acknowledges input immediately and presents cached content or a truthful, layout-stable destination shell within 100 milliseconds, without showing a blank, frozen, or misleading page. Critical semantic, layout-stability, streamed-completion, reconciliation, privacy, and cache-isolation checks are hard CI gates; environment-sensitive completion time, payload, query, and mutation measurements remain diagnostic until a repeatable post-upgrade baseline makes them reliable regression gates.
_Avoid_: Fully loaded page, zero-latency navigation, unmeasured speed claim

**Optimistic Mutation**:
A deterministic, reversible owner action whose exact next view and authoritative inverse are known, allowing Tendnote to project the change before the server confirms it. The server remains authoritative, and failure restores the prior view rather than leaving the projection as truth.
_Avoid_: Instant mutation, assumed success, client-authoritative write

**Pending Mutation**:
An acknowledged owner action whose submitted value remains visibly in progress until the server returns an authoritative result. Pending mutations preserve the owner's input but do not present unconfirmed creates, edits, links, review outcomes, imports, uploads, or external effects as settled domain truth.
_Avoid_: Optimistic mutation, completed write, background job

**Locally Blocking Mutation**:
An irreversible or authority-changing owner action that keeps its affected dialog or region unavailable until the authoritative operation succeeds or fails, while unrelated truthful regions remain usable. Identity changes may block the whole active flow.
_Avoid_: Page freeze, optimistic deletion, global loading state

**Authoritative Undo**:
The server-enforced inverse of a completed or pending Optimistic Mutation. Undo expresses the owner's desired final domain state and is serialized after any in-flight original command; it is never only a client-side cancellation.
_Avoid_: Visual rollback, request cancellation, cosmetic undo

**Provider Connection**:
A user-scoped integration authorization record for an external provider or provider capability, such as Google Calendar, Gmail, Google Contacts, or a future non-Google service. A provider connection tracks connection status and consent boundaries; it is not the same as Better Auth sign-in or product access.
_Avoid_: Login method, private beta access, provider dump

**Private Capture Channel**:
A non-web assistant entry point that lets the owner capture relationship context into Tendnote from a private conversational surface. A private capture channel may create source records or reviewable suggestions, but it is not a provider sync, shared household surface, or external-send channel.
_Avoid_: Chat sync, messaging integration, shared channel, outbound channel

**Memory Curator**:
An Eve specialist that reviews existing private relationship context and proposes cleanup, clarification, or consolidation work for the owner to approve. A memory curator is not an autonomous editor of durable memories.
_Avoid_: Auto-cleanup agent, memory janitor, silent editor

**Relationship Strategist**:
An Eve specialist that ranks private relationship context and proposes reviewable next actions, such as suggested follow-ups, based on existing memories, source records, follow-ups, birthdays, Calendar context, drafts, and retrieval signals. A relationship strategist is not the relationship agenda itself and cannot create active reminders, memories, drafts, or external actions.
_Avoid_: Agenda, recommendation engine, autonomous task creator

**Draft Proposal**:
An ephemeral assistant suggestion or preview for a possible message draft before the owner chooses to persist it as a Tendnote message draft. A draft proposal can be useful in chat or review surfaces, but it is not a saved draft and cannot be externalized to Gmail.
_Avoid_: Message draft, outbound message, Gmail draft

**Cleanup Preview**:
A sandbox-prepared, owner-reviewed set of candidate changes produced from messy private input such as CSV/vCard files, pasted lists, or old notes. A cleanup preview is not a provider sync or durable import until the owner confirms specific candidates through Tendnote review surfaces.
_Avoid_: Bulk import, sync, automatic cleanup, provider mirror

**Morning Agenda**:
A private scheduled relationship agenda for the current day that surfaces a small set of useful nudges from existing due follow-ups, birthdays, recent Calendar context, review items, and eligible relationship-strategist suggestions. A morning agenda is not continuous background scanning or an autonomous task creator.
_Avoid_: Daily task feed, pipeline, background scanner

**Post-Meeting Aftercare**:
A private scheduled workflow that reviews recent eligible Calendar events and proposes follow-ups, memory-review prompts, or draft proposals after the interaction. Post-meeting aftercare does not promote Calendar context into durable memories or drafts without owner review.
_Avoid_: Calendar sync, automatic meeting notes, auto follow-up

**Eve Mode**:
A bounded assistant capability profile that narrows Eve's tools, skills, and behavior for a specific private workflow, such as Discord capture, selected-person work, drafting, scheduled workflows, or cleanup previews. An Eve mode is not a separate assistant persona or workspace.
_Avoid_: Persona, workspace, unrestricted mode

**Household Workspace**:
A small, durable shared operating layer for one private household or trusted circle of adult Tendnote users. A user has at most one active Household Workspace; it supports active members, invitations, co-owners, and visibility controls without becoming an organization, team workspace, CRM account, or admin console.
_Avoid_: Organization, team, account, CRM workspace

**Household Invitation**:
A time-limited, email-address-bound capability created by a Household Owner that may become one active Household Membership when the recipient accepts it. An invitation reserves capacity but is not a membership, a user role, or evidence that its recipient has joined.
_Avoid_: Pending member, provisional user, membership row

**Household Member**:
A Tendnote user with an active accepted Household Membership who can see or act on records according to their role and each record's scope. A Household Member is not automatically allowed to see another member's private records.
_Avoid_: Admin user, teammate, shared owner

**Household Owner**:
A Household Member who jointly governs the Household Workspace, including invitations, membership, settings, and visibility defaults. Owners cannot unilaterally demote or remove another Owner, and the role never grants access to another member's private records.
_Avoid_: Admin, superuser, organization owner

**Household Dissolution**:
The unanimous active-Owner decision to end a Household Workspace, cancel its invitations, end its memberships, and begin the retained household-native-record closure lifecycle. It is not a member departure, a record transfer, or a unilateral owner action.
_Avoid_: Delete household, owner exit, account deletion

**Household-Native Record**:
A Personal OS record owned by the Household Workspace itself rather than by a member, such as a shared chore or a joint recurring obligation. It is visible to every active Household Member by definition, grants every active member symmetric authority without Household Owner or creator privilege, preserves creator and actor provenance, is removed by archive rather than by one member's permanent deletion, and remains with the household — with historical attribution — when a member leaves. Visibility alone never makes a member-owned record household-native; conversion is an explicit owner action.
_Avoid_: Household-scoped record, shared record, team record, ownerless record

**Responsibility Holder**:
The at most one active Household Member a household-native Action or Routine names as looking after it. A responsibility holder is a member's explicit statement, never inferred and never advanced by Tendnote on completion or skip; it answers who has this without asserting whose turn it is. It does not gate authority, order successive occurrences, or record turn counts, streaks, missed turns, or fairness between members, and handing off is an explicit member act rather than a stored rotation.
_Avoid_: Assignee, assignment, turn order, rota, chore split, workload balance

**Shared Scope**:
A visibility scope for records explicitly shared with selected Household Members. Shared scope is narrower than household scope and does not imply visibility to every member.
_Avoid_: Household scope, public, team-wide

**Household Scope**:
A visibility scope for records available to all current Household Members. Household scope is broader than shared scope but still private to the Household Workspace.
_Avoid_: Public, shared with selected members, organization-wide

**Job Family**:
A category of Postgres-owned background job that shares Tendnote's job execution mechanics — runtime mode, outbox delivery, queue publication, claim interpretation, terminal behavior, rate-limit deferral, and recovery — while keeping its own domain processor. The current job families are Suggested Memory extraction, Suggested General Action extraction, and semantic embedding, enumerated in a closed registry. A job family is not a generic event type, message topic, or queue.
_Avoid_: Event type, message topic, queue, generic worker
