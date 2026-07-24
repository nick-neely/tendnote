# Next.js 16.3 agent-tooling migration

Research date: 2026-07-23

## Question

What exact global agent-tooling migration should accompany Tendnote's
Next.js 16.3 adoption?

## Decision

Replace the retired, separately maintained Next.js knowledge skills with the
documentation and workflow split introduced for Next.js 16.3:

- Next.js knowledge comes from the version-matched docs bundled in the
  installed `next` package and reached through the managed
  `AGENTS.md` block.
- Multi-step work remains in the first-party workflow skills maintained in
  `vercel/next.js`: `next-dev-loop`, `next-cache-components-adoption`,
  `next-cache-components-optimizer`, and
  `next-partial-prefetching-adoption`.
- Tendnote uses `next-dev-loop` as the routine runtime verification loop and
  the Cache Components and Partial Prefetching skills for their named
  migrations. The current skill, rather than the launch blog, owns the live
  `agent-browser` compatibility floor.
- Next.js's built-in `/_next/mcp` endpoint is the framework view. Use
  `get_compilation_issues` for a whole-project compile check and
  `compile_route` for a targeted route check while editing, then retain the
  repository's normal full verification gates before delivery.
- Put shared skill binaries and workflow skills in the user's existing
  home-scoped setup, not in Tendnote. Put only reproducible usage guidance,
  the Next.js-managed rules, and optional client MCP configuration in the
  repository.

This is a tooling migration, not a user-facing AI feature change.

## Primary-source findings

### Bundled docs replace knowledge skills

Next.js 16.3 makes `next dev` upsert a marker-delimited block that directs
agents to `node_modules/next/dist/docs/`. The generator preserves content
outside the markers, updates an older managed block in place, and can be
disabled with `agentRules: false`. Next.js says to commit the generated block
rather than deleting a change that `next dev` will recreate. The bundled docs
track the installed framework version and require no network lookup.
([16.3 AI improvements](https://nextjs.org/blog/next-16-3-ai-improvements#bundled-docs-through-agentsmd),
[current 16.3 AI-agent guide source](https://github.com/vercel/next.js/blob/e5307e0a46c9311e39be3d34b61cbdf617cfdcfe/docs/01-app/02-guides/ai-agents.mdx),
[generator source](https://github.com/vercel/next.js/blob/e5307e0a46c9311e39be3d34b61cbdf617cfdcfe/packages/next/src/server/lib/generate-agent-files.ts))

The old `vercel-labs/next-skills` repository no longer contains skill
directories. Its migration notice says:

- `next-best-practices` is replaced by bundled docs.
- `next-upgrade` is replaced by bundled migration guides plus the official
  codemod.
- `next-cache-components` is split into
  `next-cache-components-adoption` and
  `next-cache-components-optimizer`.
- Workflow skills now live with the framework so they can stay
  version-matched.

The launch article tells users with old knowledge skills installed to run
`npx skills update` to remove them.
([retirement guidance](https://nextjs.org/blog/next-16-3-ai-improvements#first-party-skills),
[retired repository notice](https://github.com/vercel-labs/next-skills/blob/b76d687cf3e026eac3b1032f610f06b47a56377c/README.md))

### The active workflow set now has four relevant skills

The article introduced three skills:

- `next-dev-loop` combines `/_next/mcp` with `agent-browser` to verify
  compilation, runtime behavior, browser behavior, and React behavior.
- `next-cache-components-adoption` supports Incremental and Direct adoption.
  Tendnote has already chosen Direct.
- `next-cache-components-optimizer` grows useful static shells and verifies
  instant navigation with production-build tests.

The current 16.3 source adds a fourth skill directly relevant to this effort:
`next-partial-prefetching-adoption`. It walks the app through Partial
Prefetching until links reuse a shared App Shell. It belongs in this migration
rather than being rediscovered during implementation.
([16.3 workflow-skill overview](https://nextjs.org/blog/next-16-3-ai-improvements#first-party-skills),
[current skills guide](https://github.com/vercel/next.js/blob/e5307e0a46c9311e39be3d34b61cbdf617cfdcfe/docs/01-app/02-guides/ai-agents.mdx#skills-for-multi-step-workflows),
[official skills directory](https://github.com/vercel/next.js/tree/e5307e0a46c9311e39be3d34b61cbdf617cfdcfe/skills))

### `agent-browser`: use the live skill's floor

The June launch article named `agent-browser` 0.27 as the first release with
React introspection and documented `npm install -g agent-browser@^0.27`.
The live `next-dev-loop` skill has since raised its hard floor to **0.31.1**
for React introspection, worktree-scoped session IDs, idempotent restore, and
launch-flag reconciliation. Its install instruction is now
`npm i -g agent-browser@latest`. The latest official release observed during
this research is 0.33.0.

Therefore, the repository should not freeze the superseded 0.27 floor. Record
`agent-browser >=0.31.1`, install `latest` at migration time, and re-read the
installed `next-dev-loop` skill before future upgrades because its declared
floor is authoritative.
([launch requirement](https://nextjs.org/blog/next-16-3-ai-improvements#agent-browser-with-react-introspection),
[`next-dev-loop` requirement](https://github.com/vercel/next.js/blob/d6952ba67e658c34943023d1de506f24e5cc1bf3/skills/next-dev-loop/SKILL.md#requires),
[`agent-browser` installation and updates](https://github.com/vercel-labs/agent-browser/blob/1ed371f3af472cc0d6cd8fdaea75d1a085ff7534/README.md#installation),
[0.33.0 release](https://github.com/vercel-labs/agent-browser/releases/tag/v0.33.0))

React inspection requires launching with `--enable react-devtools`; the
`next-dev-loop` skill does this. The current skill also requires Next.js
16.3+, Turbopack, a running `next dev`, and a browser session scoped to the
worktree.

### The 16.3 MCP surface is smaller and compile-focused

Next.js removed the MCP server's separate knowledge base, upgrade helper, and
Cache Components helper because bundled docs and workflow skills now own
those jobs. The 16.3 surface adds:

- `get_compilation_issues`: whole-project bundler warnings and errors.
- `compile_route`: on-demand compilation and issues for one route.

Both compilation tools require Turbopack. `next-dev-loop` calls the built-in
`/_next/mcp` endpoints directly, so it needs no MCP client configuration.
For other MCP-compatible clients, the official project configuration remains:

```json
{
  "mcpServers": {
    "next-devtools": {
      "command": "npx",
      "args": ["-y", "next-devtools-mcp@latest"]
    }
  }
}
```

The client discovers a running `next dev` instance. These fast checks improve
the edit loop; they do not replace `next build`, tests, or Tendnote's delivery
verification.
([16.3 MCP changes](https://nextjs.org/blog/next-16-3-ai-improvements#a-smaller-more-focused-mcp-server),
[current MCP guide source](https://github.com/vercel/next.js/blob/e5307e0a46c9311e39be3d34b61cbdf617cfdcfe/docs/01-app/02-guides/mcp.mdx))

### Network docs are agent-readable too

For pages not present in the local bundle, append `.md` to a
`nextjs.org/docs` URL or send `Accept: text/markdown`. The compact index is
`https://nextjs.org/docs/llms.txt`; `llms-full.txt` is the full combined
corpus. Prefer the bundled docs for normal framework work because they match
the exact installed version. Use Markdown error pages from
`/docs/messages/*` when an Instant Insight links to one.
([Docs as Markdown](https://nextjs.org/blog/next-16-3-ai-improvements#docs-as-markdown))

## Read-only Tendnote and shared-tool inventory

Observed on 2026-07-23:

- `/home/neely/.agents/skills` is the user's canonical cross-repository skill
  store and contains 67 skill directories.
- Neither that directory nor `/home/neely/.agents/.skill-lock.json` contains
  `vercel-labs/next-skills`, `vercel/next.js`, a `next-*` skill, or an active
  `agent-browser` skill directory. There is therefore no retired Next.js
  knowledge skill to delete from this store today.
- The lock file has a stale historical `agent-browser` entry sourced from
  `vercel-labs/agent-browser`, but its directory is absent.
- No `agent-browser` executable or globally installed npm package is present.
- Tendnote has no `.mcp.json` and no managed Next.js marker block.
- Tendnote's root `AGENTS.md` is handwritten and intentionally minimal;
  `CLAUDE.md` already points readers to it.
- The Next.js package belongs to `apps/web`, currently at 16.2.9. In a
  monorepo the managed block's `node_modules/next/dist/docs/` path is resolved
  relative to the agent file. Because `next dev` runs for `apps/web`, the
  correct managed-file boundary is `apps/web/AGENTS.md`, where the package is
  visible—not a hand-copied block at the repository root.

No skill, browser, package, MCP configuration, or application file was
changed during this inventory.

## Exact implementation runbook

These commands are the approved future migration; they were **not** executed
during research.

### 1. Recheck and retire stale knowledge skills

Run from `/home/neely`, because this user's existing cross-repository setup is
the home directory's project-scoped `.agents/skills` store. Do not add `-g`:
for the Skills CLI's `codex` target, `-g` writes to `~/.codex/skills`, which
is not the canonical store used here.

```bash
cd /home/neely
npx skills list -a codex
```

If the inventory changes and any retired entries
(`next-best-practices`, `next-upgrade`, or `next-cache-components`) are
present, run the Next.js-prescribed migration and review the resulting
removals:

```bash
npx skills update
```

On the 2026-07-23 inventory there are no such entries, so this step is already
clean and should not churn the other shared skills merely to prove a no-op.
The Skills CLI documents `-g` as installing to an agent-specific user
directory, while project scope for Codex is `.agents/skills/`; that distinction
is why Tendnote's home-scoped convention intentionally uses project scope
from `/home/neely`.
([Skills CLI scope and commands](https://github.com/vercel-labs/skills/blob/e173b8c88f2581cfdaa1b6767c6519a08155790e/README.md#install-a-skill))

### 2. Install the workflow skills into the shared store

```bash
cd /home/neely
npx skills add vercel/next.js \
  --skill next-dev-loop \
  --skill next-cache-components-adoption \
  --skill next-cache-components-optimizer \
  --skill next-partial-prefetching-adoption \
  --agent codex \
  --yes
```

Verify the four directories and their lock entries under
`/home/neely/.agents`, then verify a fresh Codex session discovers all four.
Do not copy these skills into Tendnote.

For deliberate maintenance, update only this set from the same directory:

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

After an update, re-read each `SKILL.md` before applying it; workflow
requirements are allowed to move with the 16.3 preview.

### 3. Install and verify the browser runtime globally

```bash
npm install -g agent-browser@latest
agent-browser --version
agent-browser install
```

The version check must report at least 0.31.1. If the installed skill later
declares a higher minimum, its minimum wins. `agent-browser install` downloads
Chrome for Testing only when an existing compatible browser is not reused;
on Linux, use `agent-browser install --with-deps` only if dependency probing
shows the system libraries are missing.

### 4. Let Next.js manage its own rules at the app boundary

After Tendnote is pinned to the selected 16.3 preview, run its normal
Turbopack dev command under an AI-agent session. Allow `next dev` to create or
update `apps/web/AGENTS.md`, and commit the exact marker-delimited block it
writes:

```text
<!-- BEGIN:nextjs-agent-rules -->
...
<!-- END:nextjs-agent-rules -->
```

Do not edit inside the markers. Keep all handwritten Tendnote guidance in the
root `AGENTS.md`; the app-scoped generated file supplements rather than
replaces it. Confirm that the generated relative docs path resolves to
`apps/web/node_modules/next/dist/docs/` after installation.

### 5. Add focused repository guidance

Create `docs/agents/nextjs-agent-tooling.md` during implementation and add one
short pointer under the root `AGENTS.md`'s existing **Agent skills** section.
The focused guide should record:

- the four required workflow skill names and their shared-store location;
- `agent-browser >=0.31.1`, with the installed skill as the authoritative
  future floor;
- the Turbopack and running-`next dev` prerequisites;
- when to use each workflow;
- the direct `/_next/mcp` edit loop and the two compilation tools;
- bundled-docs-first lookup, plus `.md`, `llms.txt`, and per-error-page
  fallbacks;
- the requirement to retain Tendnote's full verification and browser matrix.

Do not duplicate the workflow skill bodies or a long command manual in the
root `AGENTS.md`.

### 6. Add MCP client configuration only at the repository boundary

If the active agent client is configured through project `.mcp.json`, add the
official `next-devtools-mcp@latest` block at the Tendnote repository root.
That is client configuration, while the discovered `/_next/mcp` endpoint
still comes from the running `apps/web` dev server. The first-party workflow
skills remain usable without this file.

## Acceptance checks for the implementation ticket

- No retired Next.js knowledge skill is present in
  `/home/neely/.agents/skills` or its lock file.
- All four current workflow skills are installed in that shared store and
  discoverable in a new Codex session.
- `agent-browser --version` satisfies the current `next-dev-loop` floor and a
  React-enabled browser session can inspect a component tree.
- The Next.js-managed block is committed at the app boundary; root handwritten
  instructions remain intact.
- An agent can read the selected 16.3 package's bundled docs.
- Against a running Turbopack dev server, `get_compilation_issues` works and
  `compile_route` can compile a named Tendnote route.
- Any committed MCP configuration discovers that same server.
- The focused repo guide exists and the root `AGENTS.md` contains only a
  concise pointer to it.
