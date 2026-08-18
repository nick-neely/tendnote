# Security and Privacy

Tendnote stores personal context about real people, the things you own, and your private to-dos. **Treat every row as sensitive by default.**

This document describes the boundaries the code actually enforces. Where a boundary is deterministic — enforced in the query layer rather than by a model or a prompt — that is called out explicitly, because it is the difference between a guarantee and a hope.

## Core principles

| Principle | What it means in code |
| --- | --- |
| **Consent-first** | Every external connection is opt-in, separately consented, and narrowly scoped |
| **Nothing leaves without approval** | External drafts require explicit approval; ambient reminder delivery requires an explicit record schedule and per-installation opt-in |
| **Suggestions are not facts** | Anything a model originates lands as a review item, never as durable state |
| **Filter before rank** | Owner, scope, sensitivity, and status filters apply in the query, before any ranking |
| **Fail closed** | Missing auth, unavailable flag providers, and denied access all deny rather than degrade open |
| **Deterministic beats prompted** | Scope enforcement lives in queries; models cannot widen it |

## Local development

- Local development uses Docker Postgres and Redis. **Do not point local dev at production data.**
- Never commit `.env` files or personal seed data. `.env*` is gitignored except the `.env.example` templates.
- Normal `pnpm verify` never requires live Google, Discord, or model credentials, and never touches a live queue.
- The dev fallback owner (`demo-user`) exists only behind Eve's **loopback-only** local authenticator (ADR 0194). The `/api/dev/demo-session` bridge is unavailable in production.

## Identity and access

Better Auth uses Postgres for durable auth records and Redis secondary storage for cache and rate-limit style data. `packages/auth` is the single shared server baseline, so the web app and Eve verify identical sessions. It requires `BETTER_AUTH_SECRET` (minimum 32 characters) in production and throws at startup without it.

Hosted access is gated by **Private Beta Access**:

- A Tendnote-owned access profile in Postgres is authoritative — an admitted user stays admitted regardless of flag state.
- Flag evaluation uses the **trusted Better Auth session entity**, so the browser cannot influence targeting.
- Grants are persisted, so admission survives flag-provider failures.
- An unavailable provider **fails closed**.
- Pending users are held on a limited pending page with no access to relationship data or Eve.

### The hosted Eve boundary

On Vercel, `/eve/v1/*` routes to the Eve service *before* Next filesystem routing, so Next middleware never sees those requests. `channels/eve.ts` is therefore the trust boundary, and it does all of the following itself:

1. Verifies the Better Auth cookie directly.
2. Requires persisted Private Beta Access.
3. Charges the owner-scoped ingress budget **before** any model work.
4. Stamps only that verified user id onto the Eve session principal.

Missing or invalid hosted auth fails closed.

The Eve deployment uses the same `BETTER_AUTH_SECRET`, `DATABASE_URL`, and
`REDIS_URL` as the web deployment so it reads the same users, encrypted account
tokens, sessions, and provider state. It also receives the same
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` when scheduled or other non-request
Calendar reads may refresh a token. This is a lifecycle-only Better Auth
configuration: Eve has no Google OAuth route, callback, sign-in, account-linking
hook, or second token store. The web deployment remains the owner of those
product and consent boundaries (ADR 0224).

## Scope and visibility

Every record carries a visibility scope: **private**, **shared with selected household members**, or **whole household**. Enforcement is deterministic and lives in the query layer, so retrieval, search, Eve tools, and UI all inherit it instead of each re-implementing it.

An asset's scope is a **ceiling** for its child records — a memory attached to an asset cannot be more visible than the asset itself. The `privacy_guard` subagent reviews but holds no tools; deterministic enforcement stays authoritative regardless of what any model concludes.

Household management is a shipped product surface: `apps/web/src/app/(admitted)/household/page.tsx` and `.../account/household/page.tsx`, backed by server actions in `apps/web/src/app/actions/households.ts`, `household-invitations.ts`, and `household-governance.ts`. Invitation acceptance requires both the emailed one-time secret and a session whose own address matches the invited address - possession plus address match, not Better Auth's `emailVerified` flag, since Tendnote sends no separate verification email. Every recipient-side failure short of that proof collapses into one indistinguishable refusal, so a guessed link cannot be used to probe invitation state.

Co-owner governance favors explicit, auditable consent over a creator-admin model: promotion to owner requires the recipient's own acceptance, no owner may unilaterally demote or remove another owner, the last owner cannot leave, and dissolution requires unanimous active-owner confirmation. Household Invitations are protected by five independent abuse-budget categories - see Rate limiting below - because seat capacity alone is not an abuse control.

Records also carry an ownership axis, separate from visibility scope: **member-owned** (an `owner_user_id`) or **household-native** (owned by the workspace itself, `packages/db/src/schema/app/common.ts`). Widening a record to household visibility never transfers ownership; converting a member-owned record to household-native is an explicit, confirmed, owner-only action with no claim-back path.

### Household dissolution and erasure

Dissolving a household ends access immediately and opens a **thirty-day recovery window** in which support can restore it. When that window closes, a bounded background sweep permanently erases the workspace: household-native records are deleted, member-owned records still pointing at the household are released back to `private`, and a single minimized tombstone survives - naming the household, the two moments, and per-family counts, filed against a scrubbed system actor rather than any member, so a household a member long since left cannot reappear on their own audit path (ADR 0221). The sweep runs on the same ten-minute recovery cron as other background work, bounded per pass, with per-household error isolation so a failure leaves that household intact for the next pass rather than half-erased.

### Account deletion

Deleting an account is gated by household governance before it can proceed: the sole owner of a multi-member household must hand off ownership first, so an account deletion can never strand the remaining members (`assertHouseholdAccountDeletionAllowed` in `packages/db/src/queries/households/account-deletion.ts`, wired into Better Auth's `deleteUser` `beforeDelete` hook). Member-owned records are deleted with the account; household-native records stay with the workspace, and creator/actor provenance on them becomes null rather than pointing at a deleted account (ADR 0214).

## Data capture and retrieval

- **People are created only on explicit user intent** — never inferred from ambiguous casual mentions.
- Global Capture writes an explicitly requested supported record directly, but inferred facts and actions remain review-gated. Its correction and undo operations use persisted outcome references, not model recollection.
- Context retrieval — snapshot loading, Global Recall, Exact Recall, semantic search, Saved Item search, and asset search — applies owner, scope, sensitivity, lifecycle, and memory-status filters **in the query layer before ranking**. Restricted content is excluded unless directly requested.
- Semantic embeddings cover only approved memories, minimized retained source-record text, General Actions, and eligible Saved Items — never raw provider dumps. Embedding jobs run through the same owner-scoped lifecycle as other background work.
- Hosted scheduled workflows enumerate only durable granted Private Beta Access profiles. The local `demo-user` principal is never used as a production background-job owner.
- Sensitive memories are excluded from briefs unless directly requested and authorized.
- Mutating data tools write audit log entries. The audit log is internal evidence, not a member-facing activity feed: entries are retained for a policy-defined period (two calendar years by default, keyed by action and entity type) and then hard-deleted with no archive, on the same recovery cron. Raw audit reads are restricted to internal support, admin, and operational tooling - never exposed to household members, including the `household.purge` tombstone itself (ADR 0223).
- Discord capture writes a **source record for review**, never a memory directly.
- Cleanup Preview parses messy input into review-only candidates and **writes nothing**.

## Asset evidence files

Asset evidence — receipts, photos, manuals — is stored as bytes in Postgres (`assetEvidenceFiles.bytes`), not in object storage. There is no public URL and no signed-URL surface to leak.

Bytes are served only through `GET /api/asset-evidence/[evidenceId]/file`, which **re-checks scope on every request** and returns `404` on every denial — never `403` — so the endpoint does not confirm the existence of records the caller may not see.

## Message drafting and external actions

External message sends and external draft creation require explicit approval. **No email, chat-message, or social-post send path exists anywhere in the product.** Opted-in reminder notifications and configured scheduled-workflow delivery are separate, bounded ambient-delivery capabilities.

Message drafting is Tendnote-internal: drafts are reviewed, edited, copied, or marked sent manually, and they persist the source references — approved memories, source records, follow-ups, brief items — that grounded them, rather than relying on prompt-only context.

Gmail draft creation is an *externalization* of an approved Tendnote draft, not a parallel drafting source of truth.

## Outbound web research

"Nothing leaves without approval" governs external *actions* - sends and drafts. Outbound web *reads* are a separate, narrower capability: provider-managed `web_search` plus a bounded `web_fetch` (HTTPS-only, 30s default/120s max timeout, 5 MB response cap). Both are gated to `web_chat` mode only (`agent/tools/eve_mode_gate.ts`) - unavailable to Discord capture, scheduled workflows, and any restricted session.

The boundary that matters is what a query can be built from: a search or fetch query may be composed only from what the user said in the active turn, never from stored Tendnote context - memories, context facts, source records, saved items, calendar, or assets - and never from restricted-sensitivity content. This is a model policy boundary rather than a query-layer filter, and it is covered by an eval (`web-research-query-egress-boundary.eval.ts`) that asserts the captured query never carries stored-context markers. Fetched content is returned to the model framed explicitly as untrusted external data, not a Tendnote record or confirmed fact.

## Reminder delivery and Web Push

Reminder delivery requires an explicit Reminder Schedule and opt-in on each authenticated browser or installed PWA. Permission is requested only from **Enable reminders**; on iOS and iPadOS, Tendnote first directs the owner to install it on the Home Screen.

Push subscriptions and keys are treated as secrets, and the VAPID private key stays server-only. Every send rechecks ownership, visibility, lifecycle, schedule, consent, and preview policy; stale work is suppressed. Notifications use generic copy unless that installation enables details. Sign-out or disablement deactivates the installation, and notification links re-authorize without mutating the record.

## Connected services

Each capability is consented separately and tracked as its own Provider Connection, distinct from Better Auth sign-in and from Private Beta Access.

### Google Calendar — `calendar.events.readonly`

Connected through Better Auth's Google provider. **Better Auth owns OAuth token custody** (encrypted at rest); no Tendnote table stores provider tokens.

Reads are minimized event summaries only — never raw provider payloads — held in a short-lived cache that is explicitly **not retrieval truth**: cached and derived Calendar context, including brief items and suggestions, never enters full-text or semantic retrieval unless explicitly promoted into durable state.

Calendar attendees match existing people by stable signals only and **never auto-create people**. Calendar-derived follow-ups stay `suggested` until accepted. Prompt nudges only send text to Eve and never mutate state.

Disconnect revokes the grant, unlinks the account, clears the cache, and blocks further reads — and cache-clearing is bound to the revoke mutation, so every path that reaches `revoked` performs it.

### Gmail — `gmail.compose`

Incremental consent, separate from Calendar and Contacts. Can create or update drafts **only** from approved Tendnote message drafts, behind explicit approval and current user intent.

It never sends email, reads Gmail history, reconciles mailbox state, stores raw Gmail payloads, exposes CC/BCC/attachments in the first slice, or retries external writes in the background. Only minimized non-secret state is persisted — draft ids, subject, confirmed recipient, status, version, non-secret errors. The body stays on the Tendnote draft row.

### Google Contacts — `contacts.readonly`

Incremental consent, separate from Calendar and Gmail, and it must use the same linked Google identity as the owner's other Google capabilities.

Contacts can be read **only** for an explicit preview flow. Unconfirmed provider rows are not durable relationship data, raw People API payloads are not stored, and confirmed imported people and contact fields remain Tendnote-owned after Contacts disconnect. Contacts import does not create drafts, send messages, infer memories or follow-ups, or enter semantic context.

### Discord

Every interaction is **Ed25519 signature-verified** against `DISCORD_PUBLIC_KEY` before any processing. Bot install uses a session-bound signed `state` plus a double-submit CSRF nonce cookie.

Proactive delivery is strictly opt-in: the sender returns `null` when unconfigured, so an unconfigured install delivers nothing. Hosted owner identity resolves through Better Auth Discord account linking; `DISCORD_OWNER_USER_MAP` is a **dev and private-beta fallback only**, never the hosted resolution path.

## Rate limiting

`@tendnote/rate-limit` applies limits by cost category rather than per route, so expensive paths are bounded even as new routes are added:

| Category | Limit | Protects |
| --- | --- | --- |
| `eve-ingress` | 30 / 60s | Model turns, charged before work begins |
| `server-action` | 60 / 60s | General mutation surface |
| `llm-extraction` | 20 / 60s | Extraction model spend |
| `embedding` | 60 / 60s | Embedding model spend |
| `provider-call` | 60 / 60s | Outbound Google and Discord calls |
| `push-delivery` | 120 / 60s | Per-installation Web Push attempts |
| `household-invitation-inviter` | 10 / hour | One person's sends |
| `household-invitation-household` | 15 / hour | All co-owners' sends, combined |
| `household-invitation-recipient` | 5 / day | One mailbox, regardless of who is inviting |
| `household-invitation-source` | 20 / hour | One request fingerprint, so a fresh account cannot reset the budget |
| `household-invitation-delivery` | 60 / hour | The deployment's total send volume |

Household Invitation abuse is bounded by five independent categories rather than one, because seat capacity alone does not stop a cancel-and-reinvite loop from harassing a recipient. Every key is charged before an external send goes out, all fail closed, and all raise the same refusal so it never discloses which one fired.

The store is pluggable — Redis in the web app, a fake in tests — so limits are exercised in tests without infrastructure.

## Adding new capability

Do not extend connected services, ambient delivery, or shared-household behavior beyond what is described here until the new surface has **code-level** privacy and approval boundaries — enforced in queries and covered by boundary tests, not described in a prompt. See the `phase-*-boundaries.test.ts` suites in `apps/agent/tests/` and `packages/db/src/queries/` for the existing pattern.
