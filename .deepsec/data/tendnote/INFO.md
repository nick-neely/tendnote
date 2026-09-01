# tendnote

## What this codebase does

Tendnote is a consent-first personal memory and household application. It stores sensitive relationship context, self-context, assets, tasks, reminders, drafts, evidence files, and household-shared records.

- **Web application and RPC:** Next.js App Router pages and Server Actions provide authenticated product reads and mutations.
  Better Auth also exposes public sign-in, password, session, and OAuth endpoints.
- **Eve assistant:** a same-origin Eve service accepts authenticated chat turns and invokes typed, owner-scoped tools.
  Discord provides a separate signature-verified capture channel.
- **Connected services:** Google Calendar and Contacts are read-only; Gmail can create or update approved drafts but has no send path.
  Discord can capture private notes and deliver explicitly configured scheduled output.
- **Asynchronous work:** Vercel Queue callbacks process extraction, embeddings, reminders, and owner exports.
  A recovery cron and an Eve schedule handle stalled jobs, retention, purges, briefs, and other bounded workflows.
- **Other ingress:** the PWA service worker receives push, notification, message, and fetch events.
  No production CLI entry point was found; repository CLIs are development, evaluation, database, or publication tooling.

## Auth shape

- **Shared Better Auth baseline:** `createTendnoteAuthOptions` centralizes the signing secret, canonical origin, secure-cookie policy, trusted origins, and secondary-storage rate limiting.
  Production refuses a missing or short secret and a non-HTTPS canonical URL.
- **Web admission:** `getCurrentAccess`, `requireAdmittedOwner`, `requireAdmittedOwnerForAction`, and `admittedOwnerOrNull` combine the Better Auth session with persisted Private Beta Access.
  Pending and unauthenticated callers do not receive owner data.
- **Server Actions:** `runOwnerAction` gates admission before parsing, resolves visibility choices, optionally charges a product budget, performs the mutation, and reconciles affected caches.
  Zod schemas are the normal runtime-input boundary.
- **Data authorization:** query entry points carry an owner or caller identifier into Drizzle predicates.
  Household access uses explicit membership, audience, ownership, lifecycle, sensitivity, and visibility predicates before records are ranked or rendered.
- **Eve and non-browser ingress:** the Eve channel verifies Better Auth cookies itself, checks admission and an ingress budget, and stamps the verified principal.
  Discord, internal reconciliation, queues, OAuth state, and cron routes use their own signature, provider, state, or secret boundaries.

## Threat model

- **Unauthenticated Internet attackers** can reach public pages, Better Auth, OAuth callbacks, Discord interactions, public metadata, and any accidentally exposed internal callback.
  Account takeover, reset-token leakage, callback forgery, replay, and resource exhaustion are primary concerns.
- **Authenticated malicious users** may guess UUIDs or forwarded links to cross owner, household, audience, or surprise boundaries.
  Treat every application row and evidence file as sensitive, including caches, exports, search results, and model context.
- **Model and prompt attackers** can influence chat text, stored user content, and fetched web content.
  Model instructions, skills, and the `privacy_guard` are not authorization boundaries; deterministic query filters and tool executors are.
- **Provider and asynchronous inputs** include Discord payloads, OAuth returns, queue messages, Web Push payloads, calendar/contact data, and scheduled rows.
  Verify authenticity, freshness, idempotency, owner binding, payload bounds, and current consent at consumption time.
- **Deployment operators** control Vercel routing, Postgres, Redis, OAuth applications, model credentials, mail, logs, and environment configuration.
  Self-hosted isolation, secret rotation, backups, edge limits, and platform callback authentication are outside application-code guarantees.

## Project-specific patterns to flag

- Flag any Server Action or admitted page that bypasses `runOwnerAction`, `requireAdmittedOwnerForAction`, or `requireAdmittedOwner` before touching owner data.
  The admitted layout is a presentation gate, not sufficient authorization for a destination read.
- Flag queries that select by record ID without owner or caller scope, or that filter visibility after search, ranking, caching, or model retrieval.
  Unscoped lookup is acceptable only after an authoritative visibility predicate has already succeeded.
- Flag model-originated facts or actions becoming durable without review, external draft creation without an approved Tendnote draft and current explicit intent, or any newly introduced message-send path.
  Also scrutinize changes to Eve mode resolution, disabled framework tools, and the model-policy-only web-research egress rule.
- Flag internal callback assumptions: the recovery cron accepts requests when `CRON_SECRET` is absent, while queue authentication is delegated to `@vercel/queue`.
  Confirm the deployed platform supplies the intended isolation, freshness, and signature guarantees.
- Flag password-reset handling that exposes tokens or personal data to logs.
  The current private-beta implementation logs the reset URL and user email for operator delivery, so production log custody is security-sensitive.

## Known false-positives

- The built-in Better Auth secret, demo owner, Discord owner map, and `/api/dev/demo-session` are development fallbacks guarded from production use.
  Do not report their mere presence without demonstrating a production-reachable path.
- `selectPersonById` is intentionally unscoped only after a visible shared follow-up proves access.
  Review the call ordering before treating this helper as an IDOR.
- Agent files for `bash`, `read_file`, `write_file`, `glob`, `grep`, and the generic `agent` tool are negative sentinels using `disableTool()`.
  Their filenames do not mean those capabilities are enabled.
- Unauthorized evidence and export requests deliberately collapse to opaque 404 responses.
  Missing 403 responses are anti-enumeration behavior, not absent authorization.
- The service worker caches only versioned shell assets, public destination configuration, and an offline page.
  `/api/` and `/eve/` requests are explicitly excluded from caching, so the existence of a service worker alone is not evidence of cached private records.
