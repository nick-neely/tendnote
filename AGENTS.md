# AGENTS.md

## Product guardrails

- Tendnote is not a sales CRM. Avoid pipeline, deal, lead-scoring, or autonomous outreach framing.
- External sends and external draft creation require explicit approval.

## Learned Workspace Preferences

- Run builds and build-bearing scripts such as `pnpm verify` with elevated permissions; sandboxed runs can hang or time out instead of reporting the real result.
- Treat pull-request CI as confirmation, not first discovery: use `pnpm test:affected` while iterating, then run every lane implicated by the diff locally before opening the PR. This means `pnpm verify` at minimum, plus `pnpm db:check` for database changes, `pnpm test:browser` for browser contracts, `pnpm test:instant` for Instant-backed behavior, and `pnpm coverage:ci && FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci` when requesting `full-ci`.
- Eve authored channel route paths are absolute; channel filenames do not mount or prefix routes.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with default label names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context domain docs use root `CONTEXT.md` and `docs/adr/`; create them lazily when terms or decisions need resolution. See `docs/agents/domain.md`.

### Next.js

Next.js supplies version-matched framework guidance and first-party workflow skills. See `docs/agents/nextjs-agent-tooling.md` for the required shared tooling and verification.

## Learned User Preferences

- Keep `AGENTS.md` minimal: only document constraints agents routinely get wrong; omit trivia and anything discoverable by searching the codebase.
- Keep shared DB/product behavior behind small owner-scoped query/mutation entry points; split adapters, product logic, tests, and schema tables into focused files before monoliths form.
- Migrations: after `db:generate`, rename drizzle's random tag to a descriptive name (`NNNN_what_it_adds.sql`) and update the matching `meta/_journal.json` tag; `pnpm db:check` must stay clean.
