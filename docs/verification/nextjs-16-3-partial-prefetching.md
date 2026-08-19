# Partial Prefetching navigation contract

> **Historical qualification evidence.** Deployment IDs and account-specific
> values below identify the run that produced this record. They are immutable
> evidence, not current Tendnote configuration or a supported deployment target.
> Current URLs must come from the configured canonical `BETTER_AUTH_URL`.

This record captures the implementation evidence for issue #309 on the pinned
Next.js 16.3 Preview. It deliberately does not treat a local development
fallback as evidence for a production owner session.

## Default shell reuse

`apps/web/next.config.ts` enables `cacheComponents` and
`partialPrefetching`. Navigation links use Next's default shell-only
prefetch contract; that contract must still be proved on the deployed owner
route before it can be credited as reusable App Shell behavior.

The two former `prefetch={false}` overrides on Asset links were removed:

- Asset Search results opt into the `/assets/[assetId]` shell-only contract.
- Eve's grounded Asset result links opt into the same contract.

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
| Every admitted page | Per-request owner boundary before owner-scoped UI | `AdmittedRouteContent` resolves `requireAdmittedOwner` inside the neutral access-check Suspense boundary; its App Shell and children receive that resolved owner only after admission. The shared wrapper does not call `connection()`, while owner-data regions establish their own request boundaries inside destination reserves. No layout above it reads or caches owner data. |
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
- Preview deployment `dpl_Ck8imQpQWV9yRgHpu6D5PJbPi1qu` (commit `5f87a9b`)
  was exercised on July 24 with two separately admitted synthetic owners. The
  cold `/` document response was PPR (`x-nextjs-prerender: 1`) and the browser
  issued segment-prefetch requests for the persistent destinations.
- That trace is a **non-passing result for #309**: the shell-prefetch requests
  for `/people`, `/actions`, `/assets`, `/saved-items`, and `/account` each
  returned 404. An actual People click then issued a second RSC request which
  returned 200, so navigation succeeds only after a failed speculative request
  and a full retry. This is harmful fan-out, not evidence of reusable-shell
  completion, and must be fixed before this ticket is closed.
- No runtime (`allow-runtime`) or imperative full prefetch was enabled while
  investigating the failure. The owner boundary and focused action tests
  remain useful local safety evidence, but they do not replace a passing
  cold/warm, cross-owner Preview measurement.
