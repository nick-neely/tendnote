# Next.js agent tooling

Tendnote uses Next.js's version-matched bundled documentation and first-party
workflow skills. The framework owns its generated agent rules; this guide owns
only the reproducible shared-tool setup that Next.js does not install.

This setup targets two agent harnesses:

- **Codex** — discovers skills from the home-scoped `.agents/skills` store.
- **Claude Code** — discovers user-level skills from `~/.claude/skills/` and
  project-level skills from `<repo>/.claude/skills/`.

## Skill directories

The Skills CLI agent flag for Claude Code is `claude-code`, not `claude`.

| Harness | Skills CLI `--agent` | Where skills live | Notes |
| --- | --- | --- | --- |
| Codex | `codex` | `~/.agents/skills/` | Canonical content store for this setup. |
| Claude Code (user) | `claude-code` | `~/.claude/skills/` | Symlinks into `~/.agents/skills/` after install. |
| Claude Code (project) | `claude-code` | `<repo>/.claude/skills/` | Repo-specific skills only; do not copy the shared Next.js workflows here. |

Run the Skills CLI from `/home/neely` without `-g`. For this setup, `-g` would
target agent-specific user directories (`~/.codex/skills` for Codex,
`~/.claude/skills` as copies instead of the shared store) rather than the
canonical `~/.agents/skills` layout used here.

## Shared workflow skills

The canonical cross-repository skill store is `/home/neely/.agents/skills`.
Installing for both harnesses writes content there once and symlinks Claude
Code into `~/.claude/skills/`.

Before the Next.js 16.3 implementation begins, inventory the shared store:

```bash
cd /home/neely
npx skills list -a codex
npx skills list -a claude-code
```

Retire `next-best-practices`, `next-upgrade`, and `next-cache-components` if
any are present. Next.js prescribes `npx skills update` for that migration.
The July 23, 2026 inventory found none of those retired skills, so do not churn
the shared store merely to prove a no-op.

Install the four current workflows for both harnesses:

```bash
cd /home/neely
npx skills add vercel/next.js \
  --skill next-dev-loop \
  --skill next-cache-components-adoption \
  --skill next-cache-components-optimizer \
  --skill next-partial-prefetching-adoption \
  --agent codex claude-code \
  --yes
```

After install, confirm:

- the four directories exist under `~/.agents/skills/`; and
- `~/.claude/skills/` contains a symlink for each skill pointing back to the
  canonical store (for example,
  `~/.claude/skills/next-dev-loop -> ../../.agents/skills/next-dev-loop`).

Use `next-dev-loop` for the normal runtime verification loop. Use the other
three skills for their named Cache Components, shell optimization, and Partial
Prefetching migrations. Their installed `SKILL.md` files are authoritative;
this guide does not duplicate their procedures.

Update only this set during a deliberate Next.js upgrade or when an installed
skill raises a compatibility requirement:

```bash
cd /home/neely
npx skills update \
  next-dev-loop \
  next-cache-components-adoption \
  next-cache-components-optimizer \
  next-partial-prefetching-adoption \
  --project \
  --yes
```

Re-read each installed `SKILL.md` after an update, then confirm both harnesses
still list all four skills.

## Agent Browser

Install the current Agent Browser globally and provision its browser:

```bash
npm install -g agent-browser@latest
agent-browser --version
agent-browser install
```

The installed version must meet the floor declared by `next-dev-loop`.
The floor observed on July 23, 2026 was `>=0.31.1`; a newer installed skill
may require more. Use `agent-browser install --with-deps` only when dependency
probing shows that Linux system libraries are missing.

## Bundled docs and managed rules

After the repository is pinned to Next.js 16.3, run the normal Turbopack
development command. Let `next dev` create or update the marker-delimited
rules in `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`, and commit the
generated result. Do not hand-author or edit inside the managed markers. The
handwritten root `AGENTS.md` remains the Tendnote-specific guidance; root
`CLAUDE.md` continues to point agents at it.

Prefer `apps/web/node_modules/next/dist/docs/` for framework knowledge because
it matches the installed version. For material outside that bundle, prefer
Next.js Markdown pages, `/docs/llms.txt`, and Markdown error pages.

## Runtime diagnostics

`next-dev-loop` talks directly to the running `/_next/mcp` endpoint. Use
`get_compilation_issues` for the whole project and `compile_route` for a
targeted route while editing. These fast Turbopack checks do not replace
Tendnote's normal build, test, or browser gates.

Do not commit a root `.mcp.json` by default. Add the official
`next-devtools-mcp` proxy only if a specific MCP client proves it cannot use
the direct workflow.

## Verification

Before delivery, confirm:

- no retired Next.js knowledge skill remains in the shared skill store;
- all four workflow skills are installed under `~/.agents/skills/` and
  discoverable in fresh Codex and Claude Code sessions;
- `~/.claude/skills/` symlinks all four Next.js workflow skills back to the
  canonical store;
- `agent-browser --version` meets the current `next-dev-loop` floor and a
  React-enabled session can inspect the component tree;
- `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` contain the blocks generated
  by the pinned Next.js version and resolve their bundled-docs path;
- `get_compilation_issues` and `compile_route` work against the running
  Turbopack dev server; and
- the repository's full verification and browser matrix still pass.
