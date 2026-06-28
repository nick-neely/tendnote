# @tendnote/web

Next.js App Router workspace for Tendnote: the dashboard, people pages, Better Auth, and the same-origin Eve chat mount.

## Layout

- `src/app` — routes: the dashboard (`page.tsx`), people list and person profile, and the Better Auth handler under `api/auth/[...all]`.
- `src/app/actions` — owner-scoped server actions (memories, source records, follow-ups, suggested follow-ups, briefs, drafts).
- `src/components` — dashboard rail, person detail, chat review cards, and draft surfaces.
- `src/components/ui` — shadcn/ui components.
- `src/components/ai-elements` — AI Elements chat primitives.
- `src/lib/auth` — Better Auth server/client setup; `src/lib/eve` — persisted Eve tool-result rendering.
- `src/proxy.ts` — validates the Better Auth session on `/eve/v1/*` and injects the trusted owner header.

## Eve chat

`next.config.ts` wraps Next with `withEve()`, which spawns `apps/agent` and proxies `/eve/v1/*` to it same-origin. The assistant panel streams turns directly via `useEveAgent` — no separate agent URL. See [`docs/architecture.md`](../../docs/architecture.md).

## Run

```bash
pnpm dev:web    # web only; from the repo root, `pnpm dev` also spawns the Eve agent
```
