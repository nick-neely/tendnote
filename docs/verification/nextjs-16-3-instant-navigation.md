# Instant Interaction contract: enforcement and evidence

This record is the implementation and measurement evidence for
[#310](https://github.com/nick-neely/tendnote/issues/310), the enforcement half
of [#300](https://github.com/nick-neely/tendnote/issues/300). It records what the
matrix runs, how the rig is built, what it measured against the recorded 16.2
baseline, and what could not be settled from a workstation.

Policy lives in [ADR 0210](../adr/0210-instant-navigation-gates-are-tiered-by-signal-and-cost.md);
this is mechanics and results.

## Running it

```bash
pnpm test:instant        # routine Chromium tier (desktop + mobile)
pnpm test:instant:full   # adds the reduced Firefox and WebKit promotion smoke
```

Both build first. They need local Postgres and Redis (`pnpm docker:up`) and
nothing else — no provider credentials, no Eve model access, no outbound network.

## The rig

### Why a production build, and how it runs

`next dev` does not prerender, so there is no static shell for `instant()` to
serve and every assertion inside it would be vacuous. The matrix therefore only
runs against `next build` + `next start`.

That immediately meets the problem recorded in the issue: `next start` sets
`NODE_ENV=production`, and Tendnote's shared Better Auth baseline
(`packages/auth/src/server.ts`) then requires an HTTPS `BETTER_AUTH_URL` and
switches on `useSecureCookies`. Left alone, every admitted route falls to the
error boundary.

**Decision: the rig gives Better Auth an HTTPS canonical URL and serves plain
HTTP on loopback.** Nothing in the application is weakened — production cookie
policy stays on, and the cookie the browser presents is the real
`__Secure-`prefixed session cookie. Chromium accepts it because `localhost` is a
trustworthy origin. This is the same shape the recorded 16.2 baseline used
([navigation baseline](../research/nextjs-16-current-navigation-baseline.md),
"Runtime"), which keeps the comparison like for like.

Two alternatives were rejected:

- **Terminating TLS locally.** A proxy hop sits directly inside the streaming
  path this suite exists to measure, and generating a certificate adds a
  CI-environment dependency for no assertion the rig gains.
- **Running the matrix against Vercel Preview.** The acceptance criteria require
  a deterministic seeded fixture, two synthetic owners, and no external network
  dependency; a shared Preview database satisfies none of those. Per
  [ADR 0211](../adr/0211-nextjs-preview-reuses-the-private-beta-release-path.md)
  the Preview is where the *real-origin* qualification happens
  ([#311](https://github.com/nick-neely/tendnote/issues/311)), running the same
  specs against the deployed URL.

The one thing the local shape does not exercise is a browser-issued Better Auth
API call, whose `Origin` would be `http://localhost:PORT` against a trusted
origin of `https://localhost:PORT`. The matrix never signs in through the
browser — it injects an already-minted session — so nothing in it depends on
that, and #311 covers it on a genuine HTTPS origin.

Everything about the rig lives in `apps/web/tests/instant/support/rig.ts`.

### Sessions are minted, not faked

`apps/web/tests/instant/support/session.ts` builds the shared Tendnote Better
Auth options, mints a session through `internalAdapter.createSession`, and signs
the cookie with the same key the server verifies. Two details matter:

- Sessions live in **Redis**, not Postgres — `apps/web/src/lib/auth/server.ts`
  configures `secondaryStorage` without `storeSessionInDatabase`, so inserting a
  `session` row would authenticate nothing.
- Both fixture owners carry a persisted `access_profiles` row with
  `status = granted`. Persisted admission short-circuits Private Beta Access
  before the Vercel Flags adapter is consulted, which is what makes the rig
  network-free. The local development fallback owner is explicitly disabled
  (`TENDNOTE_DEV_OWNER_USER_ID=""`), so the matrix proves the real admitted path
  rather than a convenience.

### The lock proof (RED before GREEN)

`experimental.exposeTestingApiInProductionBuild` is now wired in
`apps/web/next.config.ts` through `src/lib/instant/testing-api.ts`, which enables
it for an explicitly measured build (`TENDNOTE_INSTANT_MATRIX=1`) and for Vercel
Preview, and **never** for `VERCEL_ENV=production`.

Without the flag `instant()` silently no-ops and every assertion inside it passes
against fully streamed content. That was verified directly rather than assumed:

| Build | `instant()` callback asserts the People list is deferred |
| --- | --- |
| `pnpm build` (flag off) | **FAILS** — `locator('a[href^="/people/"]')` resolved to 4 elements |
| `TENDNOTE_INSTANT_MATRIX=1 pnpm build` | **PASSES** — 0 elements |

The same difference is visible at the protocol level, which is what the harness
now checks on every run before a single spec executes
(`apps/web/tests/instant/support/lock-proof.ts`): two document requests for
`/people`, one carrying `next-instant-navigation-testing=1`.

| Request | Bytes | Contains owner data |
| --- | ---: | --- |
| Ordinary admitted request | 98,869 | yes |
| With the instant-navigation cookie | 24,620 | no |

A build that fails this stops the run with an explanation instead of reporting a
green matrix that proves nothing.

### Fixture

`packages/db/src/instant/fixture-data.ts` and `seed.ts`, run through
`pnpm --filter @tendnote/db db:instant:seed` into a guarded `tendnote_instant`
database (the seed refuses any other name).

- One bounded primary owner: 4 people, 1 captured source record with the memory
  it proposes, and 7 Actions — 2 open and 1 resolved that navigation markers
  assert and nothing writes, plus one private unscheduled Action per browser
  project for the mutation scenario.
- **Reads and writes never share a record.** The suite is fully parallel and the
  mutation scenario runs once per project, so a shared Action would make the
  matrix race itself — one worker's row leaving the list while another measures a
  destination that expects it. The mutation Actions are unscheduled, which also
  keeps them out of the Today shortlist and therefore out of every navigation
  marker.
- One isolation owner with disjoint records, used only to prove that a warm cache
  cannot cross owners.
- Every identifier is a literal; every timestamp derives from one frozen instant
  (`2026-06-24T12:00:00Z`) placed safely in the past, so what the product derives
  from the real request clock cannot change an asserted count. The fixture clock
  is frozen but the *product* clock is not: a surface that windowed on recency —
  "this week", "recently added" — would eventually stop matching these records as
  real time moves away from the anchor. Nothing in the matrix reads such a
  surface today; if one is added, the anchor has to become relative to the run
  rather than absolute.
- Both owners are deleted and re-inserted per run — every product table cascades
  from `user` — so a previous run's mutations cannot leak into the next.
- The mutation scenario returns the fixture to its starting state through the
  product's own authoritative Reopen command, not by editing the database.

### Initial load versus soft navigation

ADR 0205 holds the prerendered admitted frame out of the visual tree until fresh
admission streams, so the first paint of a hard load is the owner-neutral
"Checking access…" screen. **The truthful shell of an admission-gated route on
initial load is therefore the access check, and asserting a destination shell
there would be asserting a leak.** Every scenario consequently arrives once
through a hard load, waits for `[data-admitted]`, and then measures real `<Link>`
clicks — which is where the prerendered shell actually pays off.

Source surfaces are also allowed to settle before being measured from, in two
steps. First the page reaches network idle; then the row waits until it has
actually observed an RSC response *for its own destination*. Network idle alone
is a proxy, and on a quiet machine a good one — but under contention a source can
go idle while a destination prefetch is still being scheduled, and the click then
waits on the network, turning a navigation budget into a measurement of how busy
the runner was. Both steps are bounded and fail open: a destination that never
prefetches is a finding the measurement should record, not a reason to hang. This
matches the 16.2 baseline (whose source shells had completed their prefetches
before the click) and `instant()`'s own documented assumption of a warm cache.

### Desktop Today ↔ Review is not in the matrix

Home is one destination with rail tabs. On desktop, `?tab=review` selects a rail
panel and writes the URL with `history.replaceState` — no navigation, no request,
nothing for `instant()` to assert. The mobile bottom bar's Review entry is a real
`<Link>` to a genuinely different composition, so that row is in
`mobile-navigation.spec.ts` and there is deliberately no desktop equivalent.

## What each row asserts

Every navigation row is driven three times, because one navigation cannot
honestly answer all three questions — `instant()` holds dynamic data back until
its callback returns, so any completion time measured inside it is a measurement
of how long the assertions took.

1. **cold** — first transition to the destination in the context, lock off.
2. **warm** ×3 — repeat transitions, lock off. Medians, as ADR 0210 requires.
3. **contract** — the same transition inside `instant()`, on a *fresh page* so
   the client router cache is genuinely cold.

Each measured pass gates on acknowledgement ≤ 100 ms, truthful shell ≤ 100 ms,
and CLS ≤ 0.01, then asserts authoritative owner content, that **no Shaped
Reserve remains**, and the accessibility properties ADR 0207 and 0209 promise:
exactly one route `main`, at most one visible `h1`, every pending region named,
every navigation landmark named, and focus still attached to the document.
Runtime errors are collected per context and asserted empty, which is how
hydration and module failure — ADR 0211 rollback triggers — reach a verdict.

Owner isolation (`owner-isolation.spec.ts`) always reads as the primary owner
first, so every assertion the second owner makes runs against an already-warm
cache, and additionally proves that an unauthorized person detail is
byte-identical to a missing one.

## Results

Chromium, local production build, one run, medians of the samples shown.
Two completion columns, because the two definitions answer different questions.
**DOM stable** is the 16.2 baseline's own definition — a frame plus 50 ms with no
DOM mutation, regardless of what is on screen — and is what the baseline column
beside it can honestly be compared with. **Complete** is this suite's stricter
gate: the owner's content is present *and* no Shaped Reserve remains *and* the
DOM has gone quiet. It is reported alongside rather than instead, because its
larger readings are real: several rows show a background revalidation landing
around 300 ms after the destination is already usable, which pushes the "quiet
for 50 ms" clock past it. That is visible in the gap between the two columns and
is why only the shell readings are gated.

### Desktop

| Transition | Baseline shell (first / repeat) | Now (cold / warm) | Baseline complete | Now DOM stable | Now complete | CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Today → People | 59 / 58 ms | **24 / 26 ms** | 121 / 108 ms | **74 / 76 ms** | 374 / 77 ms | 0.0000 |
| People → person detail | 207 / 93 ms | **25 / 28 ms** | 255 / 142 ms | **142 / 79 ms** | 409 / 372 ms | 0.0000 |
| Person detail → Today | 293 / 131 ms | **22 / 28 ms** | 322 / 191 ms | **106 / 79 ms** | 706 / 79 ms | 0.0000 |

### Mobile

| Transition | Baseline shell (first / repeat) | Now (cold / warm) | Baseline complete | Now DOM stable | Now complete | CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Today → Review | 81 / 76 ms | **27–77 / 10–28 ms** | 131 / 126 ms | **60–77 / 78 ms** | 77 / 78 ms | 0.0000 |
| Menu → Actions | 164 / 154 ms | **27 / 29 ms** | 213 / 201 ms | **77 / 79 ms** | 377 / 79 ms | 0.0000 |
| People → person detail | 214 / 92 ms | **24 / 29 ms** | 256 / 143 ms | **91 / 79 ms** | 391 / 79 ms | 0.0000 |
| People → Today | 286 / 125 ms | **28 / 29 ms** | 322 / 175 ms | **144 / 96 ms** | 144 / 113 ms | 0.0000 |

Against the upgrade criteria, comparing like with like on the baseline's own
definition: Today's median completion improves 67 % cold and 59 % warm on desktop
(322 → 106 ms, 191 → 79 ms) and 55 % / 45 % on mobile (322 → 144 ms,
175 → 96 ms); person detail improves 44 % / 44 % on desktop (255 → 142 ms,
142 → 79 ms) and 64 % / 45 % on mobile. No measured transition regresses against
the baseline on either viewport. Every shell reading is inside the 100 ms
contract, on every row, in both cache states.

Run-to-run variance on this workstation is a few milliseconds on warm rows and up
to ~15 ms on cold ones (mobile Today → Review measured 26–42 ms cold across
several runs), all well inside the budget. The routine matrix passed 19/19 on every
run, and ten consecutive stress runs at `--workers=6 --repeat-each=2` — twelve
concurrent browser contexts, each test duplicated — passed 38/38.

### Mutation reconciliation

| Profile | Baseline optimistic ack | Now | Baseline authoritative | Now |
| --- | ---: | ---: | ---: | ---: |
| Desktop complete | 70.5 ms | **8 ms** | 401.8 ms | **91 ms** |
| Desktop reopen | — | **11 ms** | 304.4 ms | **144 ms** |
| Mobile complete | 56.2 ms | **9 ms** | 407.7 ms | **109 ms** |
| Mobile reopen | — | **8 ms** | 310.8 ms | **108 ms** |

The baseline's recorded read-your-writes risk — "the same-page Reopen action did
not reliably re-render the restored active row" — does not reproduce. The spec
reloads after each mutation and asserts the authoritative state of its own row
both times.

One adjacent wrinkle did surface, and the spec now pins it. For roughly
150–200 ms after the reload that follows a Reopen, the restored row renders
**twice**: once in the active ledger and once in the Resolved projection behind
its closed disclosure, which has not revalidated yet. It settles to one without
intervention and was measured repeatedly (2 matches at 0/50/100 ms, 1 from
200 ms on). It is brief, self-healing, and invisible in practice, but it is a
duplicate DOM id produced by a stale secondary projection, so the assertion is a
retrying `toHaveCount(1)` — which tolerates the window and fails if the duplicate
ever becomes permanent. The fix belongs to the Resolved ledger's invalidation
tags (#305 territory) and is deliberately not attempted here.

Cumulative layout shift is `0.0000` on every row, in both cache states, on both
viewports — the reserve geometry recorded in #310's rig notes (greeting 64 px,
rail tab bar 32 px, composer 112 px) holds. The one case those reserves cannot
cover is an owner with Calendar prompt nudges, whose row arrives with the
assistant panel and shifts the empty state by roughly 29 px. This fixture has no
Calendar data, so the budget has not been exercised against that case; if it is
ever added to the fixture and 0.01 breaks, the nudge row is the cause.

### Recorded diagnostics

Cold direct load, `transferSize` for script resources, same measurement the
baseline took:

| Route | Baseline JS | Now (desktop) | Now (mobile) |
| --- | ---: | ---: | ---: |
| Today | 1,287 KiB | 1,283 KiB | **519 KiB** |
| Review | 1,287 KiB | 1,283 KiB | **519 KiB** |
| Person detail | 1,126 KiB | 1,113 KiB | 1,113 KiB |

No cold-JavaScript growth on any of the three. Mobile Today and Review drop by
60 %, because the mobile destination no longer ships the desktop composition.
Enabling `exposeTestingApiInProductionBuild` was confirmed to add **zero** client
bytes (`.next/static/chunks` is byte-identical at 19,192,873 bytes with the flag
on and off), so the measured build's payload figures are the production ones.

Request fan-out in the click window collapses from the baseline's 9–33 RSC
prefetches to **1–2 RSC responses and 1 request** on every warm transition. Per
run, the full record lands in `apps/web/.instant/diagnostics.jsonl`;
`node scripts/summarize-instant-diagnostics.mjs` renders the table above.

## Routine and promotion tiers

`apps/web/playwright.config.ts` owns the tiering, and
`scripts/instant-matrix-ci.test.ts` asserts the CI shape so it cannot quietly
drift:

- **routine** (`pnpm test:instant`) — `desktop-chromium` and `mobile-chromium`,
  the whole matrix. This is what every application pull request runs.
- **full** (`pnpm test:instant:full`) — adds `promotion-firefox` and
  `promotion-webkit`, each grepped to `@promotion-smoke`: Today as a source and
  as a destination, person detail, Action reconciliation, and owner isolation.
  Selected by the reusable workflow's `full_browser_matrix` input, for the
  framework upgrade and production promotion.

The browser job (`instant_matrix`) runs in parallel with `Quality` and
`Test and Fallow` rather than extending either, and `Verify` fails when it fails.

### One Playwright worker on CI

The first CI executions of both tiers were red, and neither failure was a
regression in the application.

**WebKit never launched.** `--disable-dev-shm-usage` was set on the shared `use`
block, and Playwright forwards `launchOptions.args` verbatim to whichever engine
a project selects. WebKit rejects an entire command line it cannot parse
(`Cannot parse arguments: Unknown option --disable-dev-shm-usage`), so all five
promotion-WebKit tests failed in 6–8 ms with `browserType.launch: Target page,
context or browser has been closed`. Firefox tolerates the flag, which is why
only the tier that runs WebKit ever saw it. The flag now belongs to the two
Chromium projects.

WebKit launches after that fix and then fails for a second, structural reason:
it will not put the production `__Secure-` session cookie on the rig's
plain-HTTP loopback socket, so every WebKit request arrives with no `Cookie`
header and every spec lands on `/sign-in`. That one is not fixable inside the
rig — see [the finding and the open decision](./nextjs-16-3-preview-qualification.md#finding-webkit-cannot-hold-the-rigs-session-cookie-open-decision).

**The timing rows were measuring the runner.** A GitHub-hosted runner is a
two-vCPU machine, and the job hosts the measured `next start` on it too. At two
workers that is two headless browsers plus a server on two cores, and the
acknowledgements degrade accordingly — `mobile Today to Review` at 127 ms and
`desktop person detail to Today` at 621 ms, with different rows breaching on each
run, which is the signature of contention rather than of a route. Reproduced on a
workstation by pinning the whole suite to one core: at two workers `Today to
Review` fails at 114 ms with the same shape as CI (`stable 64 ms` against CI's
`60 ms`); at one worker the same row records 35–57 ms and the whole matrix passes
19/19 with a worst acknowledgement of 45 ms and a worst reconciliation of 190 ms.
No budget moved. `workers` is 1 under `CI`; the parallelism ADR 0210 asks for is
between verification jobs, which is unchanged.

Two harness details came out of the same traces:

- `settleSourceSurface` waited on Playwright's `networkidle`, which is **latched**
  — it fires once per document and every later call returns immediately. The CI
  trace says so in as many words ("not waiting, `networkidle` event already
  fired") while six dynamic RSC prefetches were still in flight, so the guard
  that is supposed to precede every measured pass was doing nothing after the
  first. It now waits on the fixture's own request counter, which can be asked
  again.
- `mobile Today to Review` is the row that fails first under load, exactly as the
  Review finding below predicts: its acknowledgement is a server round trip
  (93 ms in the reproduction, issued at the click with no prefetch header)
  because there is no reusable shell to commit from. It is the row to watch if CI
  hardware ever gets slower.

## Finding: Review has no reusable shell to commit from

Mobile Today → Review meets every measured budget (26 / 25 ms shell, CLS 0), but
its `instant()` contract pass revealed something the timings hide. Review is the
one persistent-navigation destination expressed as a **search param** rather than
a path, and Next does not emit a segment prefetch for a URL carrying a query. The
source shell's requests show it plainly:

```
/actions?_rsc=…      next-router-segment-prefetch: /_tree   next-router-prefetch: 1
/?tab=review&_rsc=…  (no segment header)                    next-router-prefetch: 3
```

Every other destination gets a reusable `/_tree` shell; Review gets a full
prefetch. So with only cached content available, the router has nothing to commit
and the navigation does not move the URL at all — it lands the moment the lock
releases and the dynamic response arrives. Locally that response is a few
milliseconds; under real latency this transition is the one that would block.

The stress runs put a number on it. At `--workers=6 --repeat-each=2` — twelve
browser contexts against one `next start` process — every other row stayed inside
the 100 ms contract while this one breached it repeatedly, at 106 ms, because its
acknowledgement waits on a server response the others get from cache. On a quiet
machine it measures 27–77 ms cold and 10–28 ms warm; that spread is itself the
signature of a network-bound commit rather than a cached one.

This is not fixed here. The obvious remedy — giving Review its own pathname — is
an information-architecture change, which #300 puts explicitly out of scope, and
Home-as-one-destination-with-rail-tabs was established deliberately in `ed9c07c`.
Instead the behaviour is *pinned*: `MOBILE_REVIEW` carries
`instantContract: "dynamic-response"`, and the contract pass asserts that the URL
does not commit under the lock. If that changes in either direction the suite
fails and the decision gets re-read rather than drifting. It is the one row in the
matrix whose 100 ms shell depends on the server rather than the cache, and it
deserves a decision before the Preview promotion.

## Latent bug fixed on the way

**The Vercel-only segment-prefetch rewrite was applied on every runtime, which
404s every shell prefetch under `next start`.** The rules added for #309 map
Next's header-form segment-prefetch request onto the emitted artifact path, which
Vercel's static router can serve. `next start` serves those artifacts itself from
`.next/server/app/<route>.segments/` — not a routable path — so the rewrite turned
a request the server could answer into one it could not. Every persistent
navigation link's shell prefetch returned 404 and the click then paid for a full
RSC fetch: desktop person detail → Today acknowledged in 175 ms instead of 26 ms.

The rules now live in `apps/web/src/lib/navigation/segment-prefetch-rewrites.ts`,
gated on `VERCEL=1` at build time and covered by a unit test that asserts both
branches. The previous `segment-prefetch-routing.test.ts`, which grepped
`next.config.ts` as source text, is superseded by it.

## Not settled here

- **Aggregate CI wall time under nine minutes across three cache-warm runs.** The
  matrix itself is fast — 19 tests in **19 s** locally after a 23 s build, with
  four workers — and it runs in parallel with the existing critical path, so it
  should not extend `Verify`. But the criterion is about *CI* wall time across
  three cache-warm runs, which cannot be observed from a workstation. It must be
  read off the first three green runs of this branch before the rollout criterion
  is credited, and ADR 0210's contraction order (reuse browsers, share
  deterministic setup, remove redundant work — before weakening coverage) applies
  if it fails.
- **Firefox and WebKit promotion smoke has not been executed.** Only Chromium
  browsers are installed on this workstation. The projects, grep, and CI
  installation step are in place; the first `full` run belongs to #311.
  *Settled in #311 for Firefox (5/5 locally); WebKit needs system libraries this
  workstation cannot install and runs on CI. See
  [the Preview qualification record](./nextjs-16-3-preview-qualification.md).*
  *WebKit has now run on CI twice and cannot be admitted on the loopback rig at
  all: it refuses to send a `Secure` cookie over plain HTTP and the rig cannot
  drop the attribute, because Chromium enforces the `__Secure-` prefix on
  injection. Open decision, recorded with the evidence in
  [the qualification finding](./nextjs-16-3-preview-qualification.md#finding-webkit-cannot-hold-the-rigs-session-cookie-open-decision).*
- **Real-origin qualification.** As above: the local rig serves HTTP on loopback
  with an HTTPS canonical URL. #311 runs the same specs against the Vercel
  Preview, where the origin genuinely is HTTPS. *#311 records the Preview runbook
  and go/no-go checklist; executing it needs the open pull request's Preview.*
- **Two of ADR 0210's recorded diagnostics are not recorded: query latency and
  server work.** RSC and client payloads, request fan-out, and mutation latency
  are all captured per run; per-query time and per-route server work are not,
  because the application emits no `Server-Timing` header and has no route or
  query spans — the navigation baseline flagged exactly this gap ("Add
  attribution before query optimization"). Adding them means instrumenting the
  server, not the browser, so it is a separate change; until then the browser
  cannot attribute a slow completion to the database rather than to rendering.
- **The `full` promotion tier has no CI trigger.** `reusable-verify.yml` takes a
  `full_browser_matrix` input and both tiers are wired behind it, but the only
  caller is `pr-verify.yml`, which runs on `pull_request` and always requests the
  routine tier. Adding a dispatch path there would mean reworking its change
  detection and concurrency key, both of which are keyed on a pull-request
  number, for a run that belongs to the promotion flow. Dispatch wiring is
  therefore #311's, alongside the Preview qualification it exists to serve; today
  the full tier runs locally with `pnpm test:instant:full`. *Wired in #311:
  `.github/workflows/promotion-verify.yml` calls the same reusable verification
  with `full_browser_matrix: true`, triggered either by the `full-browser-matrix`
  label on a pull request or by `workflow_dispatch`. The label is the only one
  usable before the file reaches `main`, because GitHub offers a dispatch only
  for workflows already on the default branch. The wiring is settled; the
  workflow has never executed, and its first run is part of #311's gate.*
- **The local rig measures a routing config production never runs.**
  `segmentPrefetchRewrites()` returns `[]` off Vercel, which is what makes shell
  prefetching work under `next start` — but it also means the deployed
  application resolves segment prefetches through rewrite rules the matrix never
  exercises. The rules have unit coverage for both branches, and #311's Preview
  run is what closes the gap on the deployed path.
- **Person detail's shell heading is the generic word "Person".** The reserve
  cannot know whose page it is without reading owner data, so ADR 0207's
  "truthful destination heading" degrades to the destination's type here. It is
  truthful and it is layout-stable, but it is the weakest shell in the matrix and
  worth revisiting if person detail is ever reached from somewhere that already
  knows the name.
