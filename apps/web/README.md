# @tendnote/web

Next.js App Router workspace for Tendnote: the dashboard, people pages, Better Auth with a private-beta gate, the same-origin Eve chat mount, and the background-job queue consumers.

## Layout

- `src/app` — routes: the dashboard (`page.tsx`), people list and person profile, auth pages (`sign-in`, `sign-up`, `forgot-password`, `reset-password`, `account`, `pending`), and the Better Auth handler under `api/auth/[...all]`.
- `src/app/api/queue/*` and `src/app/api/cron/background-jobs` — Vercel Queue consumers and the recovery cron; the Vercel Flags discovery endpoint is at `.well-known/vercel/flags`.
- `src/app/actions` — owner-scoped server actions (memories, source records, follow-ups, suggested follow-ups, briefs, drafts).
- `src/components` — dashboard rail, person detail, chat review cards, draft surfaces, the account provider-connection and Google integration sections, and auth forms.
- `src/components/ui` — shadcn/ui components.
- `src/components/ai-elements` — AI Elements chat primitives.
- `src/lib/auth` — Better Auth setup; `src/lib/access` — Private Beta Access resolution and Eve ingress gating; `src/lib/integrations` — provider connections, Google Calendar connect/preview/disconnect, and Gmail draft externalization; `src/lib/background-jobs` — queue runtime and recovery; `src/lib/eve` — persisted Eve tool-result rendering.
- `src/proxy.ts` — validates the Better Auth session on `/eve/v1/*`, requires an admitted owner, and injects the trusted owner header.

## Eve chat

`next.config.ts` wraps Next with `withEve()`, which spawns `apps/agent` and proxies `/eve/v1/*` to it same-origin. The assistant panel streams turns directly via `useEveAgent` — no separate agent URL. See [`docs/architecture.md`](../../docs/architecture.md).

## Integrations

The account page links Google capabilities through Better Auth (`linkSocial`). Calendar is read-only through the shared owner-scoped reader in `@tendnote/db` — calendar context for Eve, brief highlights, and deterministic calendar-derived follow-up suggestions. Gmail uses incremental `gmail.compose` consent to create or update user-approved Gmail drafts from Tendnote message drafts; it never sends email or reads Gmail history. See [`docs/architecture.md`](../../docs/architecture.md#provider-connections-and-google-integrations) and [`docs/google-setup.md`](../../docs/google-setup.md).

## Run

```bash
pnpm dev:web    # web only; from the repo root, `pnpm dev` also spawns the Eve agent
```
