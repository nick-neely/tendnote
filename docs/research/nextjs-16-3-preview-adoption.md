# Next.js 16.3 Preview adoption contract

Research for [Establish the Next.js 16.3 Preview adoption contract](https://github.com/nick-neely/tendnote/issues/285), current as of July 23, 2026.

## Answer

Tendnote can move directly from Next.js 16.2.9 to the 16.3 Preview on its long-running implementation branch. The package and runtime seams are compatible; the consequential work is adopting the new rendering contract across the app rather than merely changing a version.

The implementation specification should require one deliberately pinned preview build, direct app-wide Cache Components adoption, app-wide Partial Prefetching, explicit Stream/Cache/Block decisions, owner-safe invalidation, and production-like navigation and deployment verification before the single production promotion. Preview drift must never enter implicitly.

## Version and package contract

On July 23, 2026, the npm tags resolve as follows:

| Package/tag | Resolved version |
| --- | --- |
| `next@preview` | `16.3.0-preview.9` |
| `@next/playwright@preview` | `16.3.0-preview.9` |
| `next@latest` | `16.2.11` |
| `next@canary` | `16.3.0-canary.94` |

The adoption should:

1. Resolve `next@preview` once at the start of implementation, replace the tag with the exact resolved version in `apps/web/package.json`, and commit the exact lockfile result. As of this research that means `next: "16.3.0-preview.9"`. Never commit `preview`, `canary`, a caret, or another floating range. The preview announcement says updates will continue and changes are likely before stable. ([Next.js 16.3: Instant Navigations](https://nextjs.org/blog/next-16-3-instant-navigations), [published npm package](https://www.npmjs.com/package/next/v/16.3.0-preview.9))
2. Pin `@next/playwright` to the same exact preview version as `next`; it owns the `instant()` helper. Tendnote already has Playwright 1.61.1, above `@next/playwright`'s declared `@playwright/test >=1.0.0` peer range. ([Instant navigation guide](https://preview.nextjs.org/docs/app/guides/instant-navigation), [`@next/playwright`](https://www.npmjs.com/package/@next/playwright/v/16.3.0-preview.9))
3. Keep React and React DOM exact and identical. Tendnote's `react` and `react-dom` 19.2.4 satisfy Next 16.3 Preview's `^19.0.0` peer range and already supply the React 19.2 capabilities used by Cache Components, including Activity and partial prerendering. A React patch upgrade is not required to unlock 16.3 and should not be silently coupled to it; if the upgrade tool changes React, evaluate and pin the pair deliberately. ([React 19.2](https://react.dev/blog/2025/10/01/react-19-2), [Next.js version 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16))
4. Retain `babel-plugin-react-compiler: "1.0.0"` and `reactCompiler: true` initially. React Compiler support has been stable since Next 16 and remains opt-in; Next documents increased dev/build compile time because it uses Babel. Measure it, but do not disable it merely as part of this upgrade. ([Next.js version 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16#react-compiler-support))

The exact published Next 16.3.0-preview.9 package requires Node `>=20.9.0`. Tendnote is already stricter: the root Volta pin is Node 24.18.0, CI runs Node 24, and Eve 0.24.3 requires Node `>=24`. Vercel currently supports Node 24 and uses it by default for new projects. The adoption contract is therefore **Node 24 end to end**, including local builds, CI, Vercel build/runtime, and generated Eve services. Add a root `engines.node` pin only if implementation finds Vercel project settings can drift; otherwise verify the deployed runtime explicitly. ([Next.js Node requirements](https://nextjs.org/docs/app/guides/upgrading/version-16#nodejs-runtime-and-browser-support), [Vercel supported Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [`eve@0.24.3`](https://www.npmjs.com/package/eve/v/0.24.3))

Next 16 requires TypeScript 5.1+ and supports Chrome, Edge, and Firefox 111+ and Safari 16.4+. Tendnote's TypeScript 5.9 satisfies that baseline. ([Next.js version 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16#nodejs-runtime-and-browser-support))

## Upgrade mechanics

Use the first-party upgrade tool against the exact target, review its diff, and then install/pin the result:

```bash
pnpm dlx @next/codemod@canary upgrade 16.3.0-preview.9
```

The general upgrade codemod can update Next/React packages and apply relevant migrations. Next 16 codemods cover top-level Turbopack config, `next lint` removal, `middleware` to `proxy`, stabilized API names, and removal of the old PPR segment export. Tendnote is already on 16.2.9 and has no middleware file, old PPR flag, old Turbopack config, or `next lint` script, so the expected meaningful diff is small and must still be reviewed rather than accepted wholesale. ([Next.js codemods](https://nextjs.org/docs/app/guides/upgrading/codemods), [Next.js version 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16))

Do **not** run `cache-components-instant-false`: that codemod creates the Incremental migration opt-out layer, while this effort chose Direct mode. The implementation should instead use the first-party `next-cache-components-adoption` skill in Direct mode and resolve each route on the long-running branch. ([Cache Components migration guide](https://preview.nextjs.org/docs/app/guides/migrating-to-cache-components))

## Framework behavior carried forward from 16.0–16.2

The specification should rely on defaults already earned in prior releases rather than adding cargo-cult flags:

- Next 16 made Turbopack the default for both `next dev` and `next build`; Tendnote's scripts already use those commands without bundler flags. Keep Turbopack. ([Next.js version 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16#turbopack-by-default))
- Next 16.1 made Turbopack's development filesystem cache stable and enabled by default. No `turbopackFileSystemCacheForDev` flag is needed. ([Next.js 16.1](https://nextjs.org/blog/next-16-1))
- Next 16 overhauled navigation with layout deduplication and incremental segment prefetching. Next 16.2 added many runtime/Turbopack improvements and exposed `experimental.cachedNavigations`, `experimental.prefetchInlining`, and other stepping-stone flags. The 16.3 public contract for this effort is top-level `cacheComponents` plus `partialPrefetching`; do not separately enable undocumented/internal 16.2 routing flags unless a measured problem and the version-matched bundled docs require one. ([Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16#routing-and-navigation), [Next.js 16.2](https://nextjs.org/blog/next-16-2), [Partial Prefetching reference](https://preview.nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching))
- Cache Components uses React Activity to retain the state of a few recently visited routes while cleaning up and recreating Effects as routes hide and return. Navigation tests must therefore cover dialogs, subscriptions, editors, and other UI that previously depended on unmounting for reset behavior. ([Cache Components reference](https://preview.nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents), [React Activity](https://react.dev/reference/react/Activity))

## Required 16.3 configuration

The target configuration is:

```ts
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // existing Tendnote configuration
}
```

`partialPrefetching` fails configuration validation without `cacheComponents`. Both are preview features and expected to become defaults only in a future major release. ([Partial Prefetching reference](https://preview.nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching), [Next.js 16.3: Instant Navigations](https://nextjs.org/blog/next-16-3-instant-navigations))

Tendnote should pin the Instant Insights default explicitly while it remains experimental:

```ts
experimental: {
  instantInsights: {
    validationLevel: "warning",
  },
  // existing Server Actions body limit
}
```

`warning` validates every Page and Default segment in development. The framework currently defaults to it, but the documentation says experimental defaults may change without a breaking release. `manual-warning` would undermine Direct adoption. Build-time validation severity is not yet a stable option, so CI must use `instant()` tests in addition to builds. ([`instant` route config](https://preview.nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant))

## Stream, Cache, or Block

An instant navigation means the browser can begin rendering the destination immediately from static, cached, or fallback UI while remaining content streams. This assumes a warm cache; the first cold fill can still wait. Direct visits and client navigations can expose different shells because a client navigation only rerenders below the shared layout. ([Instant navigation guide](https://preview.nextjs.org/docs/app/guides/instant-navigation))

Every asynchronous or request-bound read in an in-scope route must take one of these forms:

- **Stream:** fresh, volatile, expensive, or request-bound content belongs behind the lowest useful `<Suspense>` boundary with a deterministic, layout-preserving fallback. A route-level `loading.tsx` is shorthand for one broad boundary; explicit lower boundaries retain more meaningful UI in the shell. ([Blocking prerender guidance](https://nextjs.org/docs/messages/blocking-prerender-dynamic))
- **Cache:** stable owner-scoped reads may use `"use cache"` with an explicit `cacheLife` and `cacheTag`. Function arguments and closed-over values become part of the cache key, so the resolved owner ID and record identifiers must be explicit inputs. Runtime APIs such as `cookies()` and `headers()` cannot run inside a shared cache; read them outside and pass only the minimum values needed. ([`use cache`](https://preview.nextjs.org/docs/app/api-reference/directives/use-cache))
- **Block:** `export const instant = false` is allowed only where authentication, authorization, redirect selection, or another genuinely atomic flow leaves no honest shell. It disables validation for that segment but does not make the segment dynamic or fix synchronous I/O. Every shipped block needs a nearby reason and a test of the waiting experience. It must not become an app-wide or long-lived migration escape hatch. ([`instant` route config](https://preview.nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant), [Cache Components migration guide](https://preview.nextjs.org/docs/app/guides/migrating-to-cache-components))

Synchronous nondeterminism such as `Date.now()`, `new Date()`, `Math.random()`, or `crypto.randomUUID()` in a prerendered shell is a build error even with `instant = false`. Move it behind `connection()` plus Suspense or into a Client Component. ([Cache Components migration guide](https://preview.nextjs.org/docs/app/guides/migrating-to-cache-components#adopting-incrementally))

## Partial Prefetching policy

With `partialPrefetching: true`, visible links prefetch one reusable App Shell per route rather than one full response per link. Shells that read `cookies()` or `headers()` are detected and held per session in the browser client cache. Production enables real prefetching; development relies on validation and the Navigation Inspector rather than matching production timing. ([Partial Prefetching reference](https://preview.nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching), [`instant` route config](https://preview.nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant))

The implementation policy is:

- Use the default shell-only behavior everywhere.
- Add `<Link prefetch={true}>` only to persistent primary navigation and measured high-probability transitions. It can pull synchronous or `"use cache"` content deeper than the shell.
- Add `export const prefetch = "allow-runtime"` only to a destination where measurements justify the additional per-link server work. It resolves URL data such as `params` and `searchParams`; downstream segments are included in the runtime request. Cookies and headers do not require the export because the framework already includes them in the per-session App Shell when read.
- Keep existing `prefetch={false}` only where the original resource, privacy, or side-effect reason remains valid. The destination's `prefetch` export caps what links can request: `"allow-runtime"`, `"partial"`, or `"force-disabled"`. Wider prefetches cost more server CPU.

([Prefetch route config](https://preview.nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/prefetch), [Instant navigation guide](https://preview.nextjs.org/docs/app/guides/instant-navigation))

## Cache consistency and owner isolation

The implementation must preserve the agreed consistency model:

- A user-originated Server Action that changes cached data uses `updateTag` for read-your-writes behavior. It expires the tag immediately so the next read waits for fresh data. `updateTag` is valid only in Server Actions.
- Background work, webhooks, imports, Eve activity, and Route Handlers use `revalidateTag(tag, "max")` for stale-while-revalidate, or `{ expire: 0 }` only where immediate expiry is genuinely required. The single-argument `revalidateTag(tag)` behavior is deprecated.
- Existing `revalidatePath` calls remain valid, but the route-by-route design should prefer precise owner-and-entity cache tags where cached data is introduced.
- Cache keys and tags must include the owner boundary. Never cache a Better Auth session, an admission decision, a raw cookie/header collection, or owner data under a cross-owner key.

([`updateTag`](https://preview.nextjs.org/docs/app/api-reference/functions/updateTag), [`revalidateTag`](https://preview.nextjs.org/docs/app/api-reference/functions/revalidateTag), [Cache Components migration guide](https://preview.nextjs.org/docs/app/guides/migrating-to-cache-components#on-demand-revalidation-revalidatetag-revalidatepath-updatetag))

`"use cache: private"` can read request APIs, but it stores results only in browser memory, never on the server, does not contribute to the static shell, and does not survive reloads. Prefer moving the auth read outside a shared cached function and passing the owner ID; reserve the private directive for cases where that refactor is impractical. ([`use cache: private`](https://preview.nextjs.org/docs/app/api-reference/directives/use-cache-private))

The default `"use cache"` runtime store is an in-memory LRU. On serverless instances, entries may not be reused between requests, and cache keys include the build/deployment ID. Do not promise cross-instance or cross-deploy durability unless a deliberately chosen remote handler is added. ([`use cache` runtime behavior](https://preview.nextjs.org/docs/app/api-reference/directives/use-cache#use-cache-at-runtime))

## Tendnote-specific migration consequences

The current application has 17 `page.tsx` routes, all 17 export `dynamic = "force-dynamic"`, and no `loading.tsx` boundaries. Enabling Cache Components while leaving any `dynamic`, `revalidate`, or `fetchCache` segment config produces an error. Under the new model pages are dynamic by default, so every `force-dynamic` export must be removed. ([Cache Components migration guide](https://preview.nextjs.org/docs/app/guides/migrating-to-cache-components#dynamic--force-dynamic))

Most product pages call `requireAdmittedOwner()` at the top, and the access helper reads request headers before Better Auth session and private-beta admission checks. The route work therefore cannot be a mechanical removal:

1. Keep the auth/admission decision request-bound.
2. Split meaningful, owner-neutral chrome and layout-preserving fallbacks from owner data where possible.
3. Put the auth-dependent subtree behind the smallest honest Suspense boundary, or document a narrow `instant = false` where redirect/authorization makes even a safe shell misleading.
4. Pass the verified owner ID into owner-scoped cached functions so it participates in the cache key.
5. Assert that unauthenticated, pending, and admitted states never reveal another owner's shell or cached data.

Cache Components requires the Node runtime and does not support `runtime = "edge"`. Tendnote's only explicit route runtimes are already `"nodejs"` queue handlers, and its pages use the default Node runtime. ([Cache Components reference](https://preview.nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents), [Cache Components migration guide](https://preview.nextjs.org/docs/app/guides/migrating-to-cache-components#runtime--edge))

Better Auth 1.6.20 declares peers for Next `^16.0.0` and React `^19.0.0`, so there is no declared package conflict. Compatibility still needs authenticated runtime tests because the framework now keeps recent routes mounted with Activity and changes where request-time session reads suspend. ([`better-auth@1.6.20`](https://www.npmjs.com/package/better-auth/v/1.6.20), [Cache Components navigation with Activity](https://preview.nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents#navigation-with-activity))

The published `eve@0.24.3` `withEve` wrapper preserves the supplied `NextConfig`; locally it adds `beforeFiles` rewrites, while under `VERCEL` it generates Build Output services/routes and returns the resolved config. This is structurally compatible with the two new top-level flags. However, it is a deployment seam, not something a typecheck proves. The release gate must inspect the generated Vercel output and smoke-test `/eve/v1/*` routing and authenticated streaming on the preview deployment. ([`eve@0.24.3`](https://www.npmjs.com/package/eve/v/0.24.3), [Eve source repository](https://github.com/vercel/eve), [Vercel Next.js streaming support](https://vercel.com/docs/frameworks/full-stack/nextjs#streaming))

## Development and CI contract

Use all of the following; none replaces the others:

1. **Instant Insights in `next dev`:** resolve every in-scope finding with Stream or Cache unless a documented Block is warranted.
2. **Navigation Inspector:** inspect both direct page loads and client transitions. It freezes the instant UI and shows whether the shell is meaningful. Use Chrome or Firefox for the preview tooling.
3. **`instant()` tests:** add `@next/playwright` coverage for a small critical transition matrix first. Assertions inside the callback cover only immediate UI; assertions after it cover streamed completion. Run against production build output in CI.
4. **Normal browser tests:** verify streamed data resolves, cached state invalidates, optimistic mutations reconcile or roll back, and interactive client subtrees hydrate.
5. **Cross-browser runtime checks:** Chromium, Firefox, and WebKit/Safari remain supported runtime targets even though Safari's Preview Instant Insights tooling has known issues.
6. **Measurement:** record cold and warm first-click response, shell paint, streamed completion, RSC payload, client bundle, query latency, mutation completion, and server work. Next 16 removed unreliable `next build` “First Load JS” metrics and recommends browser/Vercel field measurements instead.

([Instant navigation guide](https://preview.nextjs.org/docs/app/guides/instant-navigation), [Next.js 16.3 known issues](https://nextjs.org/blog/next-16-3-instant-navigations#known-issues), [Next.js performance guidance](https://nextjs.org/docs/app/guides/upgrading/version-16#performance-improvements))

## Deployment, preview risk, and rollback

Vercel natively supports Next.js SSR, React Server Component streaming, Suspense, and Node 24. The 16.3 team reports using these preview features in its own applications, but explicitly advises discretion because the APIs can change before stable. ([Vercel Next.js support](https://vercel.com/docs/frameworks/full-stack/nextjs), [Next.js 16.3 Preview warning](https://nextjs.org/blog/next-16-3-instant-navigations#try-it-today))

The currently documented Preview issues are:

- Accessing `params` inside a shell can block without producing an Instant Insight. Navigation Inspector and `instant()` still detect the resulting behavior.
- Instant Insights tooling has Safari issues; use Chrome or Firefox for development diagnostics.
- The Navigation Inspector and `instant()` share a `next-instant-navigation-testing` cookie across projects on the same localhost domain because cookies ignore ports. Clear it or close the inspector when switching projects.

([Next.js 16.3 known issues](https://nextjs.org/blog/next-16-3-instant-navigations#known-issues), [`instant` known issue](https://preview.nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant#known-issue-shared-cookie-across-projects))

Two open upstream reports deserve targeted regression checks, not assumptions that Tendnote is affected:

- A reported production hydration failure can leave a delayed dynamic subtree behind `loading.tsx` visibly rendered but non-interactive. It reproduces across several Next versions including an early 16.3 Preview. Any new broad route loading boundary must have a production-mode interaction test. ([Next.js issue 94750](https://github.com/vercel/next.js/issues/94750))
- A reported 16.3 Turbopack/Vercel file-tracing regression involves Bun's isolated linker, explicit `serverExternalPackages`, and server packages pulled through shared client SSR chunks. Tendnote uses pnpm and declares no `serverExternalPackages`, so it does not currently match the reproduction, but a deployed route and Server Action smoke suite will catch the relevant `ERR_MODULE_NOT_FOUND` failure class. ([Next.js issue 95816](https://github.com/vercel/next.js/issues/95816))

Promotion is one stage, but qualification is not one check. Before production:

- Verify the exact pinned package and lockfile.
- Run the complete repository verification suite and the critical navigation matrix.
- Build with production-like secrets/services and inspect build diagnostics.
- Exercise authenticated, pending, and signed-out routes on the Vercel branch deployment.
- Smoke Eve session/turn streaming and Better Auth/OAuth entry points.
- Check the Vercel Function logs for route/module/cache errors.
- Confirm mutations read their own writes and background changes converge.
- Record the known-good 16.2.11 deployment and lockfile/commit so rollback is a Vercel deployment reversal.

After promotion, monitor navigation failures, server errors, auth redirects, cache isolation and freshness, mutation reconciliation, and Eve routing. Any newly selected 16.3 Preview version repeats the entire qualification; it is not a routine lockfile refresh.

## AI-agent tooling dependency

Next 16.3 writes a managed `AGENTS.md` pointer to version-matched bundled docs when `next dev` detects an AI coding agent, preserving everything outside its markers. That makes the installed package's local docs authoritative for implementation, which is especially important because the live Preview docs can move ahead of the pinned preview. The separate agent-tooling work should preserve Tendnote's handwritten root instructions outside the managed block. ([Next.js 16.3: AI Improvements](https://nextjs.org/blog/next-16-3-ai-improvements#bundled-docs-through-agentsmd))

## Resolution

Adopt one exact Next.js 16.3 Preview and matching `@next/playwright` build on Node 24; enable Cache Components and Partial Prefetching directly across all routes; remove every legacy forced-dynamic page export; make request-bound auth stream or narrowly block while all shared caches key and invalidate by verified owner; and require production-mode instant-navigation, hydration, auth, Eve/Vercel, cache-correctness, and cross-browser gates before the single promotion, with the known-good 16.2.11 deployment retained for reversal.
