# Current Next.js 16 navigation and completion baseline

Status: evidence for [Measure Tendnote’s current navigation and completion baseline](https://github.com/nick-neely/tendnote/issues/287), captured July 23, 2026.

## Executive read

Tendnote's current layout is visually stable, and most warm owner-scoped database reads are fast. The main baseline risks are route-specific RSC work, large cold client payloads on Today/Review and person detail, and broad automatic prefetch activity around link-heavy shells.

- Desktop's ordinary top-nav routes acknowledge within a median 58–80 ms. Today takes 293 ms on first client navigation and 131 ms on repeat; person detail takes 207 ms first and 93 ms repeat.
- Mobile's direct Today and Review destinations behave differently from destinations behind Menu. Today takes 286 ms first and 125 ms repeat. Review takes 81 ms first and 76 ms repeat. Menu destinations remain roughly 148–164 ms on first navigation and 150–154 ms on repeat.
- Today and Review each transfer about 1.26 MiB of JavaScript on a cold direct load. Person detail transfers about 1.10 MiB. People is the lightest measured route at about 261 KiB.
- Warm read groups take medians from 1.1 ms for People to 24.3 ms for Today context plus shortlist. These reads do not explain most observed client-navigation time by themselves.
- Completing a seeded Action acknowledges optimistically in 70.5 ms on desktop and 56.2 ms on mobile. The corresponding server-action RSC response finishes in about 402–408 ms.
- Cumulative layout shift was `0` in every captured direct load and client transition.

The current baseline therefore does not support treating database optimization as the default first move. The route shell, RSC boundary, bundle, and prefetch decisions should lead; query work should be justified by route-level tracing rather than assumed.

## Method

### Runtime

- Commit: `c57b3a6` on `docs/nextjs-16-3-instant-experience`
- Framework: Next.js `16.2.9`, React `19.2.4`, Node `24.14.0`
- Build: unchanged `pnpm build --force`; the build completed in 30.9 seconds, including a 12.6-second Turbopack compile and 13.9-second TypeScript phase
- Server: unchanged production build on local port `3100`
- Data: seeded `demo-user` against local PostgreSQL 17 and Redis
- Auth: an ephemeral demo session minted by the existing development-only session bridge; the same signed token was supplied under Better Auth's production secure-cookie name
- Production-mode canonical auth URL: temporary runtime override only; no environment or application file changed

The first production start correctly rejected the local HTTP `BETTER_AUTH_URL`. The measurement server was restarted with a temporary HTTPS canonical URL override while traffic remained local HTTP. This exercised production rendering and secure-cookie behavior without changing checked-in configuration.

### Browser profiles

- Desktop: headless Chromium, `1440 × 900`
- Mobile: Playwright's iPhone 13 profile (`390 × 844`, mobile user agent and touch model)
- Network and CPU: local loopback, unthrottled
- Samples: three serial runs per viewport; tables report medians

Each surface received a fresh-context direct load. Client navigation then measured the visible user path:

- desktop top navigation for People, Actions, Assets, Saved Items, and Account;
- mobile bottom navigation for Today and Review;
- mobile `Menu → destination` for People, Actions, Assets, Saved Items, and Account;
- People list to the seeded Alex Morgan detail on both viewports.

Review has no visible desktop link; its direct route was measured, but desktop click timing is not applicable.

### Timing definitions

- **Response start**: `PerformanceNavigationTiming.responseStart` on a fresh direct load. On loopback this approximates auth plus server rendering to first byte, not production network latency.
- **Shell**: click to target URL plus the first animation frame.
- **Complete**: click to target URL, two animation frames, and 50 ms with no DOM mutation.
- **First / repeat**: the first and second transition to the destination inside the same authenticated browser context.
- **RSC requests in click window**: all RSC responses observed after the destination click. This can include target work and prefetch requests already in flight from the source shell.
- **JavaScript transfer**: browser `transferSize` for script resources on a fresh direct load.

## Fresh direct loads

All values are medians of three fresh contexts. Transfer figures are browser-observed bytes over loopback, rounded to KiB.

### Desktop

| Surface | Response start | DOM content loaded | DOM stable | JS transfer | Total transfer |
| --- | ---: | ---: | ---: | ---: | ---: |
| Today | 37 ms | 91 ms | 351 ms | 1,287 KiB | 1,463 KiB |
| People | 7 ms | 21 ms | 158 ms | 261 KiB | 458 KiB |
| Person detail | 14 ms | 27 ms | 219 ms | 1,126 KiB | 1,291 KiB |
| Actions | 18 ms | 33 ms | 205 ms | 376 KiB | 556 KiB |
| Assets | 11 ms | 32 ms | 158 ms | 495 KiB | 660 KiB |
| Saved Items | 8 ms | 23 ms | 165 ms | 349 KiB | 525 KiB |
| Review | 42 ms | 54 ms | 364 ms | 1,287 KiB | 1,466 KiB |
| Account | 14 ms | 26 ms | 214 ms | 485 KiB | 660 KiB |

### Mobile

| Surface | Response start | DOM content loaded | DOM stable | JS transfer | Total transfer |
| --- | ---: | ---: | ---: | ---: | ---: |
| Today | 36 ms | 52 ms | 347 ms | 1,287 KiB | 1,462 KiB |
| People | 7 ms | 29 ms | 148 ms | 261 KiB | 449 KiB |
| Person detail | 13 ms | 24 ms | 223 ms | 1,126 KiB | 1,291 KiB |
| Actions | 17 ms | 30 ms | 187 ms | 376 KiB | 549 KiB |
| Assets | 10 ms | 40 ms | 214 ms | 495 KiB | 670 KiB |
| Saved Items | 7 ms | 19 ms | 163 ms | 349 KiB | 518 KiB |
| Review | 34 ms | 52 ms | 332 ms | 1,287 KiB | 1,458 KiB |
| Account | 13 ms | 27 ms | 149 ms | 485 KiB | 650 KiB |

The mobile profile changes viewport, user agent, and touch behavior, but it still runs on the desktop's CPU and loopback network. Real iPhone latency should be expected to be worse, especially for the 1.1–1.3 MiB JavaScript routes.

## Client navigation

### Desktop

| Destination | First shell | Repeat shell | First complete | Repeat complete | RSC responses, first / repeat |
| --- | ---: | ---: | ---: | ---: | ---: |
| Today | 293 ms | 131 ms | 322 ms | 191 ms | 1 / 1 |
| People | 59 ms | 58 ms | 121 ms | 108 ms | 23 / 23 |
| Person detail | 207 ms | 93 ms | 255 ms | 142 ms | 1 / 1 |
| Actions | 80 ms | 62 ms | 130 ms | 126 ms | 5 / 5 |
| Assets | 75 ms | 60 ms | 128 ms | 125 ms | 17 / 9 |
| Saved Items | 61 ms | 58 ms | 125 ms | 108 ms | 8 / 1 |
| Account | 68 ms | 58 ms | 126 ms | 107 ms | 11 / 8 |

### Mobile

| Destination | First shell | Repeat shell | First complete | Repeat complete | RSC responses, first / repeat |
| --- | ---: | ---: | ---: | ---: | ---: |
| Today | 286 ms | 125 ms | 322 ms | 175 ms | 1 / 1 |
| People through Menu | 148 ms | 151 ms | 211 ms | 201 ms | 25 / 25 |
| Person detail | 214 ms | 92 ms | 256 ms | 143 ms | 1 / 1 |
| Actions through Menu | 164 ms | 154 ms | 213 ms | 201 ms | 15 / 15 |
| Assets through Menu | 159 ms | 151 ms | 212 ms | 200 ms | 17 / 17 |
| Saved Items through Menu | 151 ms | 150 ms | 211 ms | 199 ms | 11 / 11 |
| Review | 81 ms | 76 ms | 131 ms | 126 ms | 8 / 1 |
| Account through Menu | 151 ms | 151 ms | 208 ms | 201 ms | 7 / 11 |

### RSC and prefetch behavior

The focused slow routes have meaningful target payloads:

- Today transfers about 9.3 KiB compressed for a 40.9 KiB RSC body.
- Person detail transfers about 6.9 KiB compressed for a 25.1 KiB RSC body.

The larger request counts in other rows are not equivalent to a large target payload. The source shells had already completed 9–33 RSC prefetches before the click in typical runs, and additional prefetches finished inside the click window. Link-heavy Today and People shells prefetch destination routes and multiple person details. Opening mobile Menu makes more destination links visible and is followed by a broad fan-out.

This matters even when transfer volume is modest: the destination competes with unrelated owner-scoped renders and queries. The result is clearest on mobile Menu destinations, where repeat shell timing remains around 150 ms instead of approaching the 58–62 ms desktop repeat path.

## Owner-scoped read timing

The app currently emits no `Server-Timing` header and has no per-query production timing hooks. To separate database cost from rendering and payload work without changing the app, the major route read groups were invoked directly against the seeded local database. Each group ran seven times on a warmed postgres-js pool.

| Read group | Warm median | Warm range |
| --- | ---: | ---: |
| People: `searchPeople(limit: 50)` | 1.10 ms | 0.99–1.62 ms |
| Person detail: profile plus context snapshot | 5.78 ms | 5.10–9.54 ms |
| Today: owner context plus shortlist | 24.29 ms | 20.19–30.34 ms |
| Actions: parallel route reads plus linked Assets | 9.97 ms | 9.60–10.43 ms |
| Assets: active browse plus household members | 3.99 ms | 3.33–5.74 ms |
| Saved Items: items, household members, and reminders | 1.78 ms | 1.64–1.87 ms |

These figures are local and isolate only the named read groups. They exclude Better Auth, access resolution, React rendering, serialization, app-specific Review aggregation, Account provider integration checks, and network latency. They are useful for attribution: Today has the largest measured database component, but the database still accounts for only a minority of its 125–293 ms shell time.

## Mutation timing and reconciliation

A seeded open Action was completed once per viewport, then immediately reopened. A fresh authoritative page load and direct database read confirmed the final state returned to `open`.

| Profile | Optimistic completion acknowledgement | Completion RSC finished | Reopen RSC finished |
| --- | ---: | ---: | ---: |
| Desktop | 70.5 ms | 401.8 ms | 304.4 ms |
| Mobile | 56.2 ms | 407.7 ms | 310.8 ms |

The optimistic acknowledgement satisfies the 100 ms interaction target on this machine. Server confirmation remains roughly 400 ms.

During recovery testing, the same-page Reopen action did not reliably re-render the restored active row within 10 seconds even though the server action succeeded; a fresh load immediately showed the authoritative open state. This is a read-your-writes risk worth a focused test in the optimistic-interaction decision, not a conclusion that the database write failed.

## What the evidence supports

1. **Preserve the stable visual shell.** No measured transition produced layout shift.
2. **Treat Today as the highest-priority route boundary.** It has the slowest first and repeat shell, the largest measured DB read group, a 40.9 KiB RSC body, and the largest cold JavaScript footprint.
3. **Treat person detail as the second heavy boundary.** Its first transition misses 100 ms and its cold JavaScript transfer is nearly as large as Today, even though its measured profile/context reads are small.
4. **Give mobile its own navigation contract.** Menu destinations miss 100 ms on both first and repeat paths; desktop top navigation mostly meets it.
5. **Constrain prefetch by measured transition probability.** The current link-heavy shells generate broad owner-scoped prefetch work that can overlap the selected destination.
6. **Keep optimistic acknowledgement, then tighten reconciliation.** Completion feedback is fast, but the confirmed response is materially later and Reopen exposed a same-page reconciliation risk.
7. **Add attribution before query optimization.** Route-level server timing and query spans are missing. The isolated warm DB reads are too small to justify broad query work without production-like evidence.

## Limits and follow-up evidence

- Results are comparative local evidence, not field Core Web Vitals.
- Chromium was used for the measurement harness. Safari/WebKit and Firefox runtime behavior still need the later critical-navigation matrix.
- The mobile profile is not real iPhone hardware and used unthrottled loopback networking.
- External provider calls and live Eve model work were not exercised.
- Account and Review lack isolated query-group timings because their route work crosses app-specific access, provider, and aggregation seams.
- RSC counts in click windows include pending prefetch work; a future browser trace should attach initiator and priority to each request.
- Production-like Preview instrumentation should add route render, auth/access, RSC serialization, and named owner-scoped query spans before setting final budgets.
