# Tendnote Architecture

Tendnote is a lean pnpm/Turborepo workspace. Two apps sit on top of five shared packages, and every durable read or write goes through owner-scoped query helpers in `@tendnote/db`.

## Workspace

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router UI, Better Auth routes and auth pages, the private-beta access gate, Today/Capture/Search and record surfaces, the PWA shell and reminder settings, integrations, background-job queue consumers, and the recovery cron |
| `apps/agent` | Eve — instructions, tools, subagents, skills, the `eve` and `discord` channels, and the scheduled-workflow dispatcher. See [`apps/agent/README.md`](../apps/agent/README.md) |
| `packages/db` | Drizzle schema and migrations, Postgres/Neon clients, owner-scoped queries, background-job stores, and seed data |
| `packages/domain` | Shared Zod schemas and TypeScript domain types |
| `packages/auth` | Shared Better Auth server baseline, so the web app and Eve verify identical sessions |
| `packages/rate-limit` | Cost-category product rate limiting over a pluggable store |
| `packages/config` | Shared TypeScript configuration |

`biome.json` at the root owns lint, format, and import-order configuration.

Local development runs Docker Postgres (pgvector) and Docker Redis. Production can use Neon by pointing `DATABASE_URL` at the Neon connection string.

### Import direction

```
apps/web  ─┐
           ├─→  @tendnote/auth  @tendnote/db  @tendnote/domain  @tendnote/rate-limit
apps/agent ─┘
                     @tendnote/db  ─→  @tendnote/domain
```

- `packages/auth` and `packages/rate-limit` may import infrastructure libraries but never app modules.
- `packages/domain` stays independent of apps and of database implementation code.
- Eve-specific code stays in `apps/agent`.
- `@tendnote/db` has **no root barrel** — consumers import explicit subpaths (`./client`, `./schema`, `./queries/*`) so Eve's bundle stays lean.
- `@tendnote/domain` does have a root barrel, but **client components import the specific subpath** (`@tendnote/domain/household-actions`, not `@tendnote/domain`). The barrel re-exports every module, including ones that reach for `node:crypto`, so a single barrel import in a client module pulls server-only code into the browser bundle and breaks the browser test lane. Server code may use either.

## Data model at a glance

Tendnote stores three rich subject families — **people**, **assets**, and **general actions** — plus Saved Items and the context attached to those records.

- **Source records** are logged raw context. **Memories** are approved durable facts. Extraction turns the former into suggestions for the latter.
- **Follow-ups** are reminders to reconnect with a *person*. **General Actions** are durable to-dos for the *owner*; a Routine is a General Action with a simple cadence, and Areas group them.
- **Saved Items** are the explicit fallback for notes, links, and open questions that do not belong in a richer supported family. They can carry a bring-back date or be promoted to a General Action without losing provenance.
- **Assets** carry typed asset memories, evidence files, links to people and actions, and rebuildable snapshots (ADR 0180, 0181).
- **Reminder Schedules** describe one owner-chosen alert rule or instant for an eligible record. **Reminder Installations** hold one authenticated browser/PWA subscription and its device-scoped preview choice; neither is the source record itself.
- **Context snapshots** are rebuildable caches, never truth.

Every record carries an owner and a visibility scope. An asset's scope is a ceiling for its child records (ADR 0179), and assets may link people without owning them (ADR 0178).

Records also carry an ownership axis, separate from visibility: **member-owned** (an `owner_user_id`) or **household-native** (owned by the Household Workspace itself). `householdRecordOwnershipCheck` (`packages/db/src/schema/app/common.ts`) is the database invariant - a member-owned row has an owner and no household scope requirement, a household-native row has a household id and `household` scope. Widening a record's visibility to `household` never changes who owns it; converting a member-owned record to household-native is an explicit, confirmed, owner-only action with no claim-back path (ADR 0214). The distinction is load-bearing at erasure: the household purge sweep disposes of what the workspace owns and releases everything else back to `private`.

## Capture, Today, and Global Recall

Phase Seven's web and Eve surfaces are thin adapters over the same owner-scoped product functions in `@tendnote/db`:

- **Global Capture** classifies an explicit request into a supported destination — memory, Follow-Up, General Action, Routine, or Saved Item — and records outcome references for targeted correction and undo. Inferred facts or actions remain suggestions for review.
- **Today** loads bounded candidates across relationships, Actions, Routines, Saved Items, review work, and fresh Calendar context. Deterministic eligibility, exclusions, caps, and fallback ranking remain authoritative; optional model ranking may reorder only the eligible set.
- **Global Recall** composes exact and semantic relationship context, Actions, Saved Items, Assets, and bounded Calendar results into one discriminated result union. Exact results precede Related results, and every item carries grounding plus a canonical deep link.

These functions apply owner, visibility, sensitivity, lifecycle, and authorization filters before ranking. The mobile UI and Eve therefore cannot widen one another's access or invent a write outside the shared contract.

## Retrieval and background jobs

Tendnote retrieves context in layers, all behind owner-scoped query helpers:

1. **Snapshot-backed context** — precomputed person and asset context.
2. **Global/Exact Recall** — Postgres full-text search and family-specific exact retrieval over canonical records.
3. **Semantic retrieval** — pgvector over approved memories, eligible logged source records, General Actions, and eligible Saved Items.
4. **Asset search** — unified exact-text, exact-structured-value, and fuzzy matching (ADR 0187).

Hard filters — owner, scope, sensitivity, memory status — are applied **before** any ranking, not after.

Suggested-memory extraction, action extraction, and semantic embeddings run as Postgres-owned jobs sharing one lifecycle. Local development processes them inline so capture and approval stay responsive and new context is searchable immediately; production can leave the work to a separate worker (`TENDNOTE_EMBEDDING_RUNTIME=enqueue_only`). Mutations enqueue or mark embedding work stale rather than blocking on an embedding API call (ADR 0013). Extraction runs through an LLM adapter in production and a deterministic adapter for tests and offline local development (ADR 0063).

> **Local gotcha:** the offline adapter's model version is part of every embedding idempotency key and read filter. When that fixture version changes, old local vectors are intentionally ignored — reset the disposable local Postgres volume and rerun `pnpm db:migrate && pnpm db:seed` to rebuild them.

Both apps publish outbox deliveries through one shared owner-scoped `publishBackgroundJobDelivery` in `packages/db` (ADR 0194). The queue transport is injected, so the data layer stays provider-agnostic and never imports the queue provider; the rate-limit-aware consumers live in `apps/web`. See [`background-job-delivery.md`](background-job-delivery.md) for the production foundation, recovery path, and optional live smoke test.

The same ten-minute recovery cron (`apps/web/src/app/api/cron/background-jobs/route.ts`) also runs two irreversible sweeps as a second job class alongside the extraction/embedding/reminder recovery work: the household purge sweep, which closes a dissolved household's thirty-day recovery window by erasing what the workspace owns (ADR 0221), and the audit-log retention sweep, which hard-deletes expired audit entries (ADR 0223). Both are bounded per pass - `HOUSEHOLD_PURGE_LIMIT` (3 households) and `AUDIT_RETENTION_LIMIT` (100 rows) - and the retention sweep runs as its own final stage so a failure earlier in the pass cannot block it.

## PWA and reminder delivery

The web app is an installable, online-required PWA. Its service worker caches versioned shell assets and an offline fallback; authenticated data and durable writes remain network-authoritative.

Eligible records create durable reminder jobs that publish through Vercel Queue. Before sending Web Push, the consumer rechecks the record, schedule, installation, and authorization; stale work is suppressed. Each opted-in installation receives an independent delivery. The VAPID private key stays server-side, and notification links re-authorize without mutating the record.

## Scheduled workflows

A single static Eve dispatcher schedule (`agent/schedules/brief-dispatcher.ts`) resolves hosted owners from durable granted Private Beta Access profiles, claims due Tendnote-owned schedule rows, and calls shared owner-scoped generators directly rather than starting a chat session per workflow (ADR 0066). The local `demo-user` fallback is never eligible in hosted environments. It dispatches:

| Workflow | What it produces |
| --- | --- |
| Morning agenda / weekly relationship review | Persisted daily and weekly briefs |
| Post-meeting aftercare | Review-gated follow-up suggestions after confirmed meetings |
| Birthday and gift planning | Grounded, review-gated planning prompts |
| Scoped action summary | A digest of due and overdue General Actions |

Briefs are selected **deterministically** from the shared relationship agenda — due follow-ups, birthdays, review items, recent context, semantic matches. An optional LLM summary line is presentation-only and never chooses items (ADR 0062). Generation is idempotent per owner, local date, and cadence. Each workflow can optionally deliver to Discord.

## Eve

Eve is a filesystem agent mounted into the web app, not a separate product surface.

**Modes** (`agent/lib/eve-modes.ts`) narrow which tools a session may use, and only ever restrict (ADR 0128). A mode is resolved per turn from the principal the channel's own auth stamped, never from message text or `clientContext`: `web_chat` for a signed-in owner on the web channel, `discord_capture` for the Discord surface, `scheduled_workflow` for Eve's own runtime principal, and `restricted` as the default for an origin the registry does not recognise. `web_chat` is offered the whole curated tool set; `scheduled_workflow` is held to owner-scoped reads and review-gated proposals; `discord_capture` is held to the single Source Record write its handler performs; `restricted` gets nothing.

Enforcement is `agent/tools/eve_mode_gate.ts`, a `defineDynamic` resolver that runs on `turn.started` and rebinds every withheld authored or framework capability to a definition that runs nothing and says why. eve 0.32 lets a dynamic resolver override an authored tool but not delete one, so a withheld tool is unreachable for the turn rather than hidden from the prompt. The same framework version *skips* a resolver that throws and runs the turn on the static compiled set, which means a crashing gate would fail open onto the full authored surface; the resolver mitigates that itself by reading the principal defensively, catching its own resolution, and withholding everything under `restricted` when it cannot make sense of a session. The root keeps provider-managed `web_search` and a spread-default `web_fetch` wrapper only for `web_chat`; the dynamic `web_search` shadow keeps provider injection from occurring in every other mode. Fetched content is bounded and explicitly untrusted, and search-query guidance forbids egress of stored Tendnote context. In `web_chat` the resolver contributes nothing at all, so the provider-managed search and authored fetch wrapper remain live.

ADR 0128 also named Selected Person, Drafting, and Cleanup Preview modes. All three are selected only by what a turn contains - the person page the browser reports, a request to draft, a block of pasted text - which is the one input a boundary must not trust, so they are conversation context rather than authority. What they were meant to narrow is enforced where it holds regardless of what the model is told: `cleanup_preview` writes nothing, drafts stay review-gated in the query layer, and the selected person arrives inside untrusted-data framing.

**Subagents** are narrow and proposal-only. `memory_curator` proposes cleanup, `message_drafter` proposes ephemeral drafts, `relationship_strategist` proposes follow-ups from agenda/calendar/draft context, and `privacy_guard` reviews without any tools at all — deterministic scope enforcement in the query layer stays authoritative regardless of what any model says.

**Cleanup Preview** is a sandbox: it parses messy pasted text, CSV, or vCard input into review-only candidates and writes nothing.

Eve sessions provide short-term multi-turn continuity; durable product state stays in source records, memories, actions, Saved Items, and assets (ADR 0029, 0030).

## Web chat to Eve

`apps/web/next.config.ts` wraps Next with `withEve()`, which spawns the Eve agent and mounts `/eve/v1/*` at the same origin. The assistant panel streams turns directly with `useEveAgent` (`eve/react`) — no server-side turn proxy, no Eve URL, no CORS (ADR 0061).

On Vercel, `withEve()` routes that prefix to the separate Eve service **before** Next filesystem routing. Next middleware therefore never sees these requests, which makes `channels/eve.ts` the hosted trust boundary: it reads the browser's Better Auth cookie, verifies the session using the shared database/Redis configuration, requires persisted Private Beta Access, charges the shared Eve ingress budget, and stamps the verified user id onto the session principal. Missing auth fails closed; only loopback development can resolve the configured demo owner (ADR 0194).

## Access and private beta

Hosted access runs behind a Private Beta Access gate. A Tendnote-owned access profile in Postgres is authoritative: an admitted user stays admitted regardless of the flag. Unadmitted users are evaluated against a server-side Vercel Flags flag (`private-beta-access`) using the **trusted Better Auth session entity**, so the browser cannot influence targeting. A grant is persisted durably so admission survives later flag-provider failures, and an unavailable provider fails closed (ADR 0067).

Pending users land on `/pending` and never reach the app shell, relationship data, or Eve. Server-side resolution lives in `apps/web/src/lib/access`; the Eve channel independently verifies the same cookie and persisted decision at its own boundary. Local development admits the dev fallback owner only through Eve's loopback authenticator.

## Provider connections and integrations

A **Provider Connection** is a user-scoped record of an external integration's authorization and consent boundaries, distinct from Better Auth sign-in and from Private Beta Access (ADR 0069). Google and Discord capabilities are linked through Better Auth (`linkSocial`) from the account page, and the linked account's identity and granted scopes mirror into capability-specific Provider Connections. Each capability is consented separately and tracked separately.

### Google Calendar — read-only

Calendar is read through **one** shared owner-scoped seam, `readConnectedOwnerCalendar`, that web previews, Eve's `list_calendar_events`, the brief generator, and the suggestion workflow all use, so provider behavior never forks (ADR 0072, 0074, 0075).

The reader is cache-aside over a short-lived, minimized event cache. Live Google is the source of truth; the cache stores only normalized `CalendarEventSummary` rows — never raw payloads — keyed by owner, connection, calendar, and bounded window, and **it is not retrieval truth** (ADR 0079). It is served fresh within its TTL, served stale only within a fallback window on live failure, pruned past that horizon on each live read, and fully cleared on revoke.

The provider adapter and access token are injected by the caller — token custody stays in Better Auth — so the shared seam never reaches for Google credentials itself. Failures degrade gracefully: a disconnected or temporarily unavailable calendar yields no context rather than throwing (ADR 0081).

Disconnect revokes the Google grant, unlinks the Better Auth account (so reads are blocked and account-link reconcile cannot re-connect), and clears cached events. Cache-clearing is bound to the connection's revoke mutation, so any path reaching `revoked` performs it (ADR 0080).

Calendar-derived follow-up suggestions are generated deterministically from recent confirmed meetings, matched to existing people (never creating any), capped, deduped, and held for review. An optional LLM step may refine the reason but cannot widen scope, bypass caps, or create anything (ADR 0077, 0078, 0082).

### Gmail — drafts only

Gmail externalizes approved, source-grounded Tendnote message drafts rather than creating a parallel Gmail-native drafting path (ADR 0083). It uses incremental `gmail.compose` consent, tracked separately as `google/gmail` (ADR 0090).

Gmail draft actions persist minimized non-secret provider state — source Tendnote draft id, Gmail draft id, subject, confirmed recipient, status, version, non-secret errors. The message body stays on the Tendnote draft row; raw Gmail payloads, mailbox labels, thread metadata, and history are never stored (ADR 0084, 0094). Gmail can create or update drafts after explicit approval, but never sends email, reads Gmail history, reconciles sent/deleted/edited draft state, exposes CC/BCC/attachments in the first slice, or background-retries failed writes (ADR 0088, 0089, 0091, 0095).

### Google Contacts — preview only

Contacts uses incremental `contacts.readonly` consent, tracked separately as `google/contacts`, and is blocked if the linked Google identity differs from the existing Google capability identity. It reads only for an explicit preview flow; unconfirmed provider rows are not durable relationship data, raw People API payloads are not stored, and confirmed imported people and contact fields remain Tendnote-owned after disconnect.

### Discord — capture and delivery

The Discord channel verifies Ed25519 interaction signatures against `DISCORD_PUBLIC_KEY` before doing anything else. Capture writes a **source record** for review — never a memory directly — and enqueues extraction, action-extraction, and embedding jobs. A capture reply carries a "Review in Tendnote" button. The human-in-the-loop clarification path behind it is built and tested but not yet reachable: clicking *Clarify* parks an owner-scoped session in Redis (TTL matched to Discord's 15-minute interaction window) before the modal opens, and the submit consumes that session and captures the clarification as another source record for review, tagged with the session it clarifies, so any instance can serve either half. What is missing is the button — no capture response renders `discordClarificationComponents` today, so nothing in production reaches the modal. Whether a capture should offer Clarify, and on what signal, is an open product question; the durable machinery is in place for when it is answered. Attachments are refused while the interaction is parsed, and an unreachable store or an unexpected failure answers with an ephemeral message instead of a failed interaction.

Proactive delivery POSTs to configured channel targets with `DISCORD_BOT_TOKEN` and returns `null` when unconfigured, so delivery is strictly opt-in. Hosted owner identity resolves through Better Auth Discord account linking; `DISCORD_OWNER_USER_MAP` is a dev/private-beta fallback only, not the hosted resolution path. See [`discord-setup.md`](discord-setup.md).

## Household scope

Every record carries a visibility scope: **private**, **shared with selected members**, or **whole household**. Scope is enforced deterministically in the query layer, so retrieval, search, Eve tools, and UI all inherit it rather than each re-implementing it. `packages/db/src/queries/households.ts` owns membership and share mutations, with the invitation, governance, and erasure lifecycle split out under `packages/db/src/queries/households/`.

Household management is a shipped product surface: `apps/web/src/app/(admitted)/household/page.tsx` and `.../account/household/page.tsx` are the routes, backed by server actions in `apps/web/src/app/actions/households.ts`, `household-invitations.ts`, and `household-governance.ts`. A Household Invitation is a separate, email-address-bound, expiring capability rather than a pending membership; acceptance requires the emailed secret plus a session whose own address matches the invited one. Co-owner governance favors explicit, auditable consent over a creator-admin model - promotion requires the recipient's acceptance, no owner may unilaterally demote or remove another owner, the last owner cannot leave, and dissolution requires unanimous active-owner confirmation (ADR 0213).

Dissolving a household opens a thirty-day recovery window, after which a bounded background sweep permanently erases it: household-native records are deleted, member-owned records still pointing at the household are released back to `private`, and a minimized tombstone survives, filed against a scrubbed system actor (ADR 0221). Deleting a member account is gated the same way - the sole owner of a multi-member household must hand off ownership before their account can be deleted, so an account operation cannot strand the remaining members (ADR 0214).

## Rate limiting

`@tendnote/rate-limit` defines cost categories rather than per-route limits: `eve-ingress` (30/60s), `server-action` (60/60s), `llm-extraction` (20/60s), `embedding` (60/60s), `provider-call` (60/60s), and `push-delivery` (120/60s). Household Invitation abuse gets five further independent categories rather than a route limit - `household-invitation-inviter` (10/hour), `household-invitation-household` (15/hour), `household-invitation-recipient` (5/day), `household-invitation-source` (20/hour), and `household-invitation-delivery` (60/hour) - because seat capacity alone does not stop a cancel-and-reinvite loop from harassing a recipient. The store is pluggable — Redis in the web app, a fake in tests — so limits are testable without infrastructure.
