# Next.js 16.3 Preview foundation verification

This record is the baseline for the direct Cache Components delivery sequence
in specification [#300](https://github.com/nick-neely/tendnote/issues/300).

## Starting point

- Baseline commit: `ab4557d626a21c50299c27cffb71c29c69e04eba`
  (`Specify Next.js 16.3 instant Tendnote experience (#299)`).
- Upgrade tool: `pnpm dlx @next/codemod@canary upgrade 16.3.0-preview.9`.
- Exact framework pins: Next.js and `@next/playwright`
  `16.3.0-preview.9`; React and React DOM `19.2.8`.
- The auth and agent workspaces declare the same exact Next.js pin, so Better
  Auth resolves against one Preview version across the full workspace.
- The codemod selected the aligned React patch pair and exact React type
  packages. Its invalid workspace-local `pnpm.overrides` block was removed;
  the exact direct type dependencies remain.

## Runtime floor

- The canonical `/home/neely/.agents/skills` store contains the four official
  Next.js workflows: `next-dev-loop`, `next-cache-components-adoption`,
  `next-cache-components-optimizer`, and
  `next-partial-prefetching-adoption`. The retired Next.js knowledge skills
  are absent.
- Agent Browser `0.33.0` meets the `next-dev-loop` floor (`>=0.31.1`) and its
  Chrome `151.0.7922.47` runtime is provisioned.
- Starting `next dev` on the pinned package generated
  `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`; the former resolves bundled
  Next.js documentation relative to the web workspace.

## Development smoke

- Next.js `/_next/mcp` listed `get_compilation_issues` and `compile_route`.
  The all-route Turbopack compilation probe returned `issues: []`.
- The restored authenticated browser session rendered Today, including the
  shortlist and mobile primary navigation. Opening Eve rendered its panel and
  composer without submitting a prompt. MCP reported no config or session
  errors.

## Delivery gates

- `pnpm verify`: passed (typecheck, lint, unit tests, and production
  Turbopack build).
- `pnpm test:browser`: passed (2 files and 7 real-browser tests).
- `pnpm why next --recursive`: one resolved version,
  `16.3.0-preview.9`.
