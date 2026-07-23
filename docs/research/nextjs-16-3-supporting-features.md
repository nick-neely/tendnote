# Next.js 16–16.3 supporting feature choices

Research for [Choose the supporting Next.js 16–16.3 feature set](https://github.com/nick-neely/tendnote/issues/291), current as of July 23, 2026.

This note covers only supporting capabilities beyond the Instant Navigations contract in
[`nextjs-16-3-preview-adoption.md`](./nextjs-16-3-preview-adoption.md) and the agent migration in
[`nextjs-16-3-agent-tooling.md`](./nextjs-16-3-agent-tooling.md).

## Recommended feature set

| Disposition | Capability | Tendnote choice |
| --- | --- | --- |
| Adopt | Turbopack dev persistence and 16.3 memory eviction | Keep both 16.3 defaults. Do not add redundant flags. The dev cache has been stable and on by default since 16.1; 16.3 also enables eviction by default and can spill evicted compiler work to disk instead of growing memory with every visited route. ([Next.js 16.1](https://nextjs.org/blog/next-16-1#turbopack-file-system-caching-for-next-dev), [Next.js 16.3 Turbopack](https://nextjs.org/blog/next-16-3-turbopack#reducing-memory-usage-in-dev-mode)) |
| Measure | Turbopack persistent cache for `next build` | A/B cold and warm local builds before enabling `experimental.turbopackFileSystemCacheForBuild`. It is still experimental, and reusable CI cache requires preserving the relevant `.next` cache between runs. Tendnote's Turbo task currently excludes `.next/cache/**`, so enabling the flag alone would not make its cache durable in CI. Do not expand CI artifacts until timings show a material win and cache size/invalidation are understood. ([16.3 build cache](https://nextjs.org/blog/next-16-3-turbopack#file-system-cache-for-builds), [cache reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache)) |
| Measure | Rust React Compiler | Keep `reactCompiler: true` with Tendnote's exact `babel-plugin-react-compiler: 1.0.0` as the known baseline. Test `experimental.turbopackRustReactCompiler` in an A/B branch against build time, browser tests, and interaction behavior; adopt it only if it is materially faster without output or behavior regressions. The Rust integration is experimental and its cited 20–50% compilation gains are early results from other large apps. ([16.3 Rust compiler](https://nextjs.org/blog/next-16-3-turbopack#experimental-rust-react-compiler), [stable Next integration](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler), [React Compiler upgrade caution](https://react.dev/blog/2025/10/07/react-compiler-1#upgrading-react-compiler)) |
| Adopt as a tool | Turbopack Bundle Analyzer | Use `next experimental-analyze` on demand before and after the navigation migration, especially for the mobile shell, editor, AI UI, and server-only packages. Record route-specific client/server import chains and bundle deltas; do not make an experimental interactive analyzer a required CI gate. ([Next.js 16.1](https://nextjs.org/blog/next-16-1#nextjs-bundle-analyzer-experimental), [package-bundling guide](https://nextjs.org/docs/app/guides/package-bundling#nextjs-bundle-analyzer-experimental)) |
| Adopt | Default diagnostics | Retain error-only browser-to-terminal forwarding, Server Function execution logs, hydration server/client diffs, `Error.cause` chains, and `next dev --inspect` / `next start --inspect` as debugging tools. Error forwarding needs no config; do not forward all console output by default in a private-memory product. Temporarily raise `logging.browserToTerminal` to `warn` only while diagnosing a known client issue. ([browser log forwarding](https://nextjs.org/blog/next-16-2-ai#browser-log-forwarding), [16.2 diagnostics](https://nextjs.org/blog/next-16-2#server-function-logging)) |
| Adopt, version-gated | Server-backed error retry | When the pinned 16.3 bundled docs still expose it, replace the current root `error.tsx` `reset()` retry with `unstable_retry()`: it refreshes Server Component data and then clears the boundary inside a Transition, while `reset()` alone cannot recover an RSC/data-fetch failure. Keep the existing calm failure UI and production telemetry. ([Next.js 16.2 retry](https://nextjs.org/blog/next-16-2#unstable_retry-in-errortsx), [error-handling guide](https://nextjs.org/docs/app/getting-started/error-handling#nested-error-boundaries)) |
| Measure | New scroll/focus handler | Test `experimental.appNewScrollHandler` on mobile and desktop with keyboard, screen reader, hash links, back/forward, long lists, dialogs, and editor flows. Its browser-like blur behavior may be better than focusing a deep descendant, but focus placement is an accessibility and product choice, not a compiler default to accept unseen. ([Next.js 16.2](https://nextjs.org/blog/next-16-2#experimentalappnewscrollhandler)) |
| Defer | View Transitions and `transitionTypes` | Do not enable `experimental.viewTransition` for the migration. Next.js still calls it experimental and not recommended for production; React's `<ViewTransition>` and `addTransitionType` remain Canary APIs. `transitionTypes` is useful only after Tendnote chooses a concrete animation language. If later piloted, limit it to one orientation-preserving transition, default other transitions to `none`, and honor `prefers-reduced-motion`. ([Next.js warning](https://nextjs.org/docs/app/api-reference/config/next-config-js/viewTransition), [`transitionTypes`](https://nextjs.org/blog/next-16-2#transitiontypes-prop-for-nextlink), [React accessibility guidance](https://react.dev/reference/react/ViewTransition#always-check-prefers-reduced-motion)) |
| Defer | Component-level `unstable_catchError()` | The root route boundary plus targeted mutation failure states are sufficient today. Add a component boundary only where one independently retryable remote subtree would otherwise take down useful surrounding UI; do not scatter an unstable abstraction through the component tree. ([Next.js 16.2](https://nextjs.org/blog/next-16-2#unstable_catcherror)) |
| Reject as separate flags | `experimental.cachedNavigations` and `experimental.prefetchInlining` | Do not enable either alongside the chosen 16.3 Cache Components plus Partial Prefetching contract. Cached Navigations is a 16.2 control for behavior now owned by that migration; prefetch inlining trades reusable segment data for fewer requests and should be considered only if measured request fan-out is a real bottleneck. ([Next.js 16.2](https://nextjs.org/blog/next-16-2#experimentalcachednavigations), [16.3 Partial Prefetching](https://nextjs.org/blog/next-16-3-instant-navigations#partial-prefetching)) |
| Reject for now | `import.meta.glob`, local PostCSS lookup, and custom Adapters | Tendnote has no file-glob content collection, package-local PostCSS requirement, or custom deployment-platform build adapter. These add novelty without a use case; Eve/Vercel compatibility should be verified through the existing wrapper and deployment tests. ([16.3 Turbopack](https://nextjs.org/blog/next-16-3-turbopack#importmetaglob), [local PostCSS](https://nextjs.org/blog/next-16-3-turbopack#local-postcss-configuration), [stable Adapter API](https://nextjs.org/blog/next-16-2#adapters)) |

## Improvements inherited without configuration

The 16.3 upgrade automatically carries forward the 16.0 navigation rewrite, 16.2's faster
Server Component deserialization and Server Fast Refresh, 16.3's smaller conditional Turbopack
runtime, HMR/startup improvements, and failed chunk-fetch retry. These should be regression-tested
and measured, but they are not separate Tendnote features or flags to adopt.
([Next.js 16 routing](https://nextjs.org/blog/next-16#enhanced-routing-and-navigation),
[Next.js 16.2](https://nextjs.org/blog/next-16-2#faster-rendering),
[Next.js 16.3 compatibility](https://nextjs.org/blog/next-16-3-turbopack#compatibility-and-reliability))

The version-matched `get_compilation_issues` and `compile_route` tools belong to the already-chosen
`next-dev-loop`, not to application configuration. Use targeted route compilation while editing,
then retain Tendnote's normal typecheck, tests, production build, and browser verification.
([16.3 MCP changes](https://nextjs.org/blog/next-16-3-ai-improvements#a-smaller-more-focused-mcp-server))

## Resolved choices

1. **Compiler/toolchain baseline:** keep the default development persistence and eviction, the Babel
   React Compiler, and on-demand bundle analysis. Build persistence and the Rust compiler remain
   measured opt-ins rather than day-one Preview dependencies.
2. **Navigation motion:** keep Tendnote motionless across routes for this migration. A later effort may
   pilot one meaningful View Transition with reduced-motion and interruption testing after the shell
   contract is stable.
3. **Focus behavior:** treat the new scroll/focus handler as a serious measured candidate, not a
   default. Adopt it only if the keyboard, screen-reader, hash-link, history, long-list, dialog, and
   editor matrix demonstrates an accessibility improvement without regressing deliberate focus
   restoration.
4. **Client log sensitivity:** keep terminal forwarding at errors only. Warning forwarding may be
   enabled temporarily for a bounded investigation, but owner content, credentials, and provider
   payloads must never be logged.

## Resolution

Adopt the zero-config Turbopack memory/dev-cache and diagnostic improvements; keep the stable Babel
React Compiler as the initial baseline; measure build persistence, the Rust compiler, bundle shape,
and the new focus handler before promotion; use server-backed retry if the pinned docs retain it;
defer View Transitions and granular catch boundaries; and reject standalone cached-navigation,
prefetch-inlining, glob-import, local-PostCSS, and Adapter flags without a measured Tendnote need.
