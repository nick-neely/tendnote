# @tendnote/web

Next.js App Router workspace for Tendnote: the mobile-first Today, Capture, Search, people, actions, Saved Items, and assets surfaces; the installable PWA and reminder settings; Better Auth with a private-beta gate; the same-origin Eve chat mount; integrations; and background-job queue consumers.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Today — a bounded cross-record shortlist, review work, compact Eve composer, and primary mobile navigation |
| `/people`, `/people/[personId]` | People list and person profile |
| `/actions`, `/actions/today` | General Actions, Routines, Areas, and the focused action-only view |
| `/saved-items` | Notes, links, and open questions with lifecycle, bring-back, source, and promotion controls |
| `/assets`, `/assets/[assetId]` | Assets list and Asset profile (memories, evidence, links, actions) |
| `/reminders/open` | Authenticated notification deep-link resolver; re-authorizes the record without mutating it |
| `/account` | Identity, access status, and provider connections |
| `/account/contacts/import` | Google Contacts import preview and confirmation |
| `/account/discord` | Discord install status and per-workflow delivery targets |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/pending` | Auth and pending-access pages |

### API routes

- `api/auth/[...all]` — Better Auth handler.
- `api/queue/extraction`, `api/queue/embedding`, `api/queue/reminder` — Vercel Queue consumers.
- `api/cron/background-jobs` — recovery cron for stalled deliveries.
- `api/integrations/discord/install` and `install/callback` — bot-install OAuth with a session-bound signed `state` and a double-submit CSRF nonce.
- `api/asset-evidence/[evidenceId]/file` — gated evidence byte serving; re-checks scope per request and returns 404 on every denial.
- `.well-known/vercel/flags` — Flags Explorer discovery endpoint.
- `api/dev/demo-session` — local-only Better Auth session bridge for the dev fallback owner; unavailable in production.

## Layout

- `src/app/actions/*.ts` — thin server adapters over owner-scoped product functions (conversational Capture, Today, Global Recall, memories, source records, follow-ups, Saved Items, Reminder Schedules and installations, briefs, drafts, general actions and areas, assets, review/evidence/links/action proposals, contact import, Gmail drafts, integrations). Note that `src/app/actions/` is both the server-action directory and the `/actions` route.
- `src/components` — Today, mobile shell and Capture, Search, review queue, person detail, action/Saved Item/asset surfaces, reminder opt-in and installation settings, chat result cards, drafts, account integrations, and auth forms.
- `src/components/ui` — shadcn/ui components. `src/components/ai-elements` — AI Elements chat primitives.
- `src/lib/auth` — Better Auth web setup over the shared `@tendnote/auth` baseline.
- `src/lib/access` — Private Beta Access resolution.
- `src/lib/integrations` — provider connections, Google Calendar connect/preview/disconnect, Gmail draft externalization, Contacts import preview, and the Discord connection/install/disconnect modules.
- `src/lib/rate-limit` — the Redis-backed store and guards over `@tendnote/rate-limit`.
- `src/lib/background-jobs` — queue runtime, reminder Web Push delivery, and recovery. `src/lib/cache` — request-scoped caching.
- `src/lib/eve` — persisted Eve tool-result rendering and hosted-boundary policy coverage.

## PWA and reminders

Production registers `/sw.js` and serves a standalone web app manifest with iOS and maskable icons. The installed shell caches only versioned static assets and an honest offline page; Today, Eve, authentication, and every durable read or write still require a connection.

Installing the PWA does not require environment variables. Web Push does: configure one stable VAPID keypair through `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY`, plus a `WEB_PUSH_VAPID_SUBJECT` contact URI. See [`.env.example`](.env.example). On iPhone and iPad, add Tendnote to the Home Screen first, launch it there, then use the explicit **Enable reminders** action; a browser tab never requests notification permission on render.

## Eve chat

`next.config.ts` wraps Next with `withEve()`, which mounts `apps/agent` at `/eve/v1/*` same-origin. On Vercel that path routes directly to the Eve service before Next filesystem routing, so the Eve channel — not Next middleware — owns session verification, beta admission, and ingress limiting. The assistant panel streams turns directly via `useEveAgent`; there is no separate agent URL and no CORS. See [`docs/architecture.md`](../../docs/architecture.md#web-chat-to-eve).

## Integrations

The account page links Google and Discord capabilities through Better Auth (`linkSocial`), and each capability is tracked as its own Provider Connection with its own consent.

- **Calendar** is read-only through the shared owner-scoped reader in `@tendnote/db` — calendar context for Eve, brief highlights, and deterministic post-meeting follow-up suggestions.
- **Gmail** uses incremental `gmail.compose` consent to create or update Gmail drafts from approved Tendnote drafts. It never sends email or reads mail.
- **Contacts** uses incremental `contacts.readonly` consent for an explicit preview flow only.
- **Discord** installs a bot for private capture and optional proactive delivery of scheduled workflows.

See [`docs/architecture.md`](../../docs/architecture.md#provider-connections-and-integrations), [`docs/google-setup.md`](../../docs/google-setup.md), and [`docs/discord-setup.md`](../../docs/discord-setup.md).

## Run

```bash
pnpm dev:web    # web only; from the repo root, `pnpm dev` starts web + Eve in parallel
```
