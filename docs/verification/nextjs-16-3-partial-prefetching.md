# Partial Prefetching navigation contract

This record captures the implementation evidence for issue #309 on the pinned
Next.js 16.3 Preview. It deliberately does not treat a local development
fallback as evidence for a production owner session.

## Default shell reuse

`apps/web/next.config.ts` enables `cacheComponents` and
`partialPrefetching`. Navigation links therefore use Next's default reusable,
owner-neutral App Shell behavior: persistent desktop navigation, dense result
lists, mobile Review, and default destination panes do not request a full
owner response merely because the link enters the viewport.

The two former `prefetch={false}` overrides on Asset links were removed:

- Asset Search results now reuse the `/assets/[assetId]` shell.
- Eve's grounded Asset result links now reuse the same shell.

There are no intentional `prefetch={false}`, `prefetch={true}`,
`prefetch = "allow-runtime"`, or imperative full-prefetch exceptions in the
application source. Search, Capture, Eve, Menu, provider previews/imports,
and inactive panes remain interaction-started by their own client boundaries;
they do not gain route-data prefetch from these links.

## Depth decision

Person and Asset detail remain default shell-only candidates. The July 23
baseline records person-detail first navigation at 207 ms desktop / 214 ms
mobile, but also records broad link-shell fan-out and does not yet attribute
production-like completion, freshness, or server-work cost per deeper
prefetch. Enabling runtime prefetch would create per-link server work without
the evidence required by ADR 0208, so it is intentionally deferred.

## Route and authority inventory

| Contract | Reuse or exception | Evidence |
| --- | --- | --- |
| Desktop navigation, dense People and Asset results, mobile Review, and default destination panes | Default shell-only link behavior | Source audit finds no `prefetch` prop, route `prefetch` export, or `router.prefetch` call. The two Asset-only suppressions were removed in this change. |
| Search, Capture, Menu, inactive panes, and provider work | Intentional interaction-started exception; no route-data prefetch | These are client focused flows or deferred regions, not navigation links. `app-shell.dom.test.tsx` opens and closes a focused Search flow without changing the destination shell; #307's account coverage keeps provider operations behind their explicit controls. |
| Eve | Intentional interaction-started exception; no route-data prefetch | `eve-launcher.dom.test.tsx` proves no Eve-context action runs before **Open Eve** and exactly one runs after it. `eve-context.test.ts` proves the action resolves the current admitted owner and performs no reads when that gate rejects the caller. |
| Every admitted page | Per-request owner boundary before owner-scoped UI | `AdmittedRouteContent` calls `connection()` before `requireAdmittedOwner`; its App Shell and children receive that resolved owner only after the request boundary. No layout above it reads or caches owner data. This prevents an owner-specific response from becoming a reusable shell. |
| Person and Asset detail | Default shell-only; no runtime exception | No `allow-runtime` route export is present. The baseline's broad fan-out means deeper request-time work is intentionally deferred. |

## Cold, warm, and production checks

- A development Navigation Inspector route sweep covered `/`, `/people`,
  `/actions`, `/assets`, `/saved-items`, `/account`, and `/?tab=review` with
  no compile or runtime diagnostic. Development is used only for inspector
  validation; it is not presented as production prefetch timing evidence.
- `pnpm verify` produced the Next 16.3 production route table with every
  admitted route marked Partial Prerender. A local `next start` response also
  carries `Vary: rsc, next-router-prefetch, next-router-segment-prefetch`,
  `x-nextjs-prerender: 1`, `x-nextjs-postponed: 1`, and a 300-second stale
  time, confirming the built App Shell/PPR protocol is active.
- The local production server correctly refuses the development fallback
  identity: production requires an HTTPS Better Auth URL and an admitted
  session. Therefore it cannot honestly supply an owner-switch browser trace
  from this workstation. The source boundary and focused action tests above
  are local boundary evidence only; they do not substitute for a warm-shell
  cache measurement.
- A deployment or Preview run with two admitted synthetic owners remains the
  required final measurement before enabling any deeper runtime prefetch. It
  must record cold and warm client transitions, RSC initiators and counts,
  completion timing, and a cross-owner switch. Until that measurement exists,
  this change keeps the safe shell-only default and enables no request-time
  prefetch work.
