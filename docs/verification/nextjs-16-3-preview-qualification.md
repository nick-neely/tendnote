# Next.js 16.3 Preview: qualification, promotion, and reversal

This is the operator record for
[#311](https://github.com/nick-neely/tendnote/issues/311) — qualifying the exact
Next.js 16.3 Preview candidate, promoting it once through Tendnote's existing
private-beta release path, and keeping a verified way back.

Policy lives in
[ADR 0211](../adr/0211-nextjs-preview-reuses-the-private-beta-release-path.md)
(release path, observation, rollback triggers) and
[ADR 0210](../adr/0210-instant-navigation-gates-are-tiered-by-signal-and-cost.md)
(gate tiers). Local enforcement evidence lives in
[the Instant Interaction record](./nextjs-16-3-instant-navigation.md). This
document is the part that only a real deployment can answer, plus the checklist
the go/no-go decision is read from.

**Nothing here promotes anything.** Every step below is either already done and
recorded, or is an instruction for the operator to run at the marked point in
the release.

## Candidate

| | |
| --- | --- |
| `next` | `16.3.0-preview.9` (exact) |
| `@next/playwright` | `16.3.0-preview.9` (exact) |
| `react` / `react-dom` | `19.2.8` (exact, identical) |
| Branch | `ship/issue-300` |
| Vercel project | `tendnote-web` (`prj_hdGusP01mnLoDvQc3CQ1gha2at7E`, team `nick-neely`) |

## The reversal target

ADR 0211 requires the last known-good commit and Vercel deployment to be
recorded and retained before merge. They are:

| | |
| --- | --- |
| Commit | `5757f5bfd379805448666d105bee35854ce80954` — *automate Discord command registration (#283)* |
| Next.js on that commit | **`16.2.9`** |
| Vercel deployment id | `dpl_EPFJFXRhbc7dFxqGXfuhHRCJ7Tnx` |
| Deployment URL | `https://tendnote-6okpbh0iz-nick-neely.vercel.app` |
| Production alias | `https://tendnote-web-nick-neely.vercel.app` (also `…-git-main-…`) |
| Created | 2026-07-23 15:25:30 UTC — the READY production build for that push |
| State when recorded | `READY`, currently serving production |

Read off a workstation with the Vercel CLI, read-only. The commit-to-deployment
link is confirmed by Vercel's own metadata rather than inferred from timestamps:

```bash
vercel ls --prod --scope nick-neely          # newest READY production build
vercel inspect <that url> --scope nick-neely # id, aliases, created
vercel ls --prod --scope nick-neely --meta githubCommitSha=<sha>
```

Two things about that record are worth stating plainly.

**The known-good version is 16.2.9, not 16.2.11.** ADR 0211, `docs/prd.md`, and
the adoption research all said the rollback target was Next.js 16.2.11 (the ADR
and the PRD's procedural line now carry corrections; the dated research doc is
left as the record of what was true when it was written). `16.2.11`
was the `next@latest` npm tag on the day the research was written — it was never
Tendnote's pin. `apps/web/package.json` read `16.2.9` from the first commit until
`10a4c6e` pinned the Preview, and `git log -S '"next": "16.2.11"'` finds nothing.
The reversal target is therefore a 16.2.9 deployment. This does not change the
decision or the procedure; it corrects the number the procedure names.

**Reversal is a pure deployment reversal.** `git diff origin/main...HEAD --
packages/db/migrations` is empty: the upgrade branch adds no migration, so
promoting the older deployment does not leave the schema ahead of the code.
Re-check that immediately before merge — if the branch grows a migration, this
row stops being true and the reversal needs a schema decision first.

**It is one commit behind `main`, and that is correct.** `main`'s tip is
`ab4557d` (*Specify Next.js 16.3 instant Tendnote experience (#299)*), which
touches only `docs/`. `production-migrations.yml` gates deployment on a path
filter covering `apps/`, `packages/`, `public/`, and the root manifests, so that
commit never produced a production build — production still serves `5757f5b`'s.
Expect this whenever the last commit on `main` is documentation: the reversal
target is the last *deployed* commit, not the last commit.

**Retention.** Do not delete `dpl_EPFJFXRhbc7dFxqGXfuhHRCJ7Tnx` while the
observation window is open. Vercel retains deployments by default; the only way
to lose this one is to remove it deliberately.

**Reversal command** — the same command the release workflow already uses to
promote, pointed at the older deployment. No second promotion system, no
automation:

```bash
vercel promote dpl_EPFJFXRhbc7dFxqGXfuhHRCJ7Tnx --yes --scope nick-neely
```

Then confirm `https://tendnote-web-nick-neely.vercel.app` serves the reverted
build and sign-in still works, and record the time and trigger below.

## What is already proved, and where

| Claim | Evidence | Where |
| --- | --- | --- |
| Repository verification and production build | `pnpm verify` — pass, 2026-07-25, on this record's own commit (parent `42d4d8c`); re-run before merge | this branch |
| Full Chromium critical-navigation matrix, CLS, streamed completion, focus, a11y | `pnpm test:instant` — 19/19, 2026-07-25 | [Instant Interaction record](./nextjs-16-3-instant-navigation.md) |
| Completion-time improvement over the 16.2 baseline, no cold-JS growth | recorded diagnostics | same |
| Two-owner cache and privacy isolation, unauthorized ≡ missing | `owner-isolation.spec.ts` | same |
| Mutation reconciliation (optimistic ack, authoritative settle) | `action-reconciliation.spec.ts` | same |
| Request-bound admission | `admitted-route.contract.test.ts`, `src/lib/access/*.test.ts` | unit suite |
| Reduced Firefox qualification | `--project=promotion-firefox` — 5/5, 2026-07-25 | below |
| Reduced WebKit qualification | **blocked on a decision** — executed in CI twice, and the loopback rig cannot admit an owner on WebKit at all | below |

### Reduced Firefox and WebKit qualification

ADR 0210's reduced promotion tier is `@promotion-smoke`: desktop Today as source
and as destination, person detail, Action complete-and-reopen, and owner
isolation, on Firefox and WebKit.

**Firefox: 5/5 passed**, local production build, 2026-07-25.

```bash
cd apps/web
pnpm build:instant
TENDNOTE_INSTANT_MATRIX=1 TENDNOTE_INSTANT_SCOPE=full \
  pnpm exec playwright test --project=promotion-firefox
```

| Transition | Ack / shell (cold / warm) | DOM stable (cold / warm) | CLS |
| --- | ---: | ---: | ---: |
| Today → People | 3 / 12 ms | 85 / 80 ms | 0.0000 |
| People → person detail | 9 / 13 ms | 109 / 80 ms | 0.0000 |
| Person detail → Today | 9 / 14 ms | 108 / 81 ms | 0.0000 |

| Mutation | Authoritative |
| --- | ---: |
| Action complete | 93 ms |
| Action reopen | 146 ms |

Every row is inside the 100 ms Instant Interaction contract and the `0.01` CLS
budget, the `instant()` contract pass holds on all three transitions, owner
isolation holds against a warm cache, and the per-context runtime-error
assertion — the hydration/module rollback trigger — is empty. Three things the
engine could plausibly have broken and did not: the production `__Secure-`
session cookie is accepted over loopback (Firefox treats `localhost` as
trustworthy, as Chromium does), the prerendered shell commits before the dynamic
response on every row, and `instant()`'s cookie-driven lock works outside
Chromium. The run records no payload figures: `payload-diagnostics.spec.ts` is
not tagged `@promotion-smoke`, because cold JavaScript weight is a property of
the build rather than of the engine and is already measured on Chromium.

**WebKit: not executed on this workstation.** The browser downloads
(`webkit-2311`) but will not launch — Playwright's Linux host check reports ~14
missing system libraries (`libgstvideo`, `libavif`, `libwoff2dec`, `libenchant`,
`libhyphen`, `libsecret`, …). Installing them needs `playwright install-deps`,
which needs `sudo`, and this environment has no passwordless `sudo`. It was not
attempted interactively.

WebKit is therefore CI's, not a workstation's, and `Promotion verify` has now run
it twice. See the finding below: **the loopback rig cannot admit an owner on
WebKit at all**, so WebKit's engine evidence is not obtainable from this rig and
belongs to the deployed Preview.

#### Finding: WebKit cannot hold the rig's session cookie (open decision)

`Promotion verify` run 30170042186 was WebKit's first execution anywhere. It
failed at launch, not on behaviour: `--disable-dev-shm-usage` sat on Playwright's
shared `use` block, which forwards `launchOptions.args` verbatim to whichever
engine a project selects, and WebKit rejects a command line it cannot parse
(`Cannot parse arguments: Unknown option --disable-dev-shm-usage`). All five
tests died in 6–8 ms. The flag now belongs to the two Chromium projects.

Run 30171146025 is the real result. WebKit launches, and all five specs time out
after 30 s waiting for `[data-admitted]`, having navigated to `/sign-in`. The
traces say why in one line — **every WebKit request carries no `Cookie` header at
all**, where the Chromium trace for the same spec carries
`__Secure-better-auth.session_token=…`:

```
webkit    200 /                     | cookie: NONE
webkit    200 /api/auth/get-session | cookie: NONE
webkit    200 /sign-in              | cookie: NONE
chromium  200 /people/<id>          | cookie: __Secure-better-auth.session_token=F7xtGxyY…
```

Three deliberate decisions collide, and no two of them can be kept together on
WebKit:

1. **The shared auth baseline mints `__Secure-` cookies under production.**
   `packages/auth/src/server.ts` sets `useSecureCookies: production` and refuses
   a non-HTTPS `BETTER_AUTH_URL` in production. Both are the security baseline,
   not rig configuration.
2. **The rig serves plain HTTP on loopback.** `rig.ts` records why: terminating
   TLS locally puts a proxy hop inside the streaming path this suite exists to
   measure.
3. **WebKit will not put a `Secure` cookie on a plain-HTTP socket**, and unlike
   Chromium and Firefox it does not exempt `localhost`. (Playwright also drops
   `domain: "localhost"` cookies on WebKit restore independently of this;
   microsoft/playwright#39380, #35712.)

The obvious escape — inject the same cookie without the `Secure` attribute — was
tried and does not exist. Chromium enforces the `__Secure-` name prefix on
injection too: the storage state is refused with `Storage.setCookies: Invalid
cookie fields` and all 19 routine tests fail before their first navigation.
Renaming the cookie would mean the rig no longer presents the production session
token, which is the property that makes the matrix worth anything.

**Recommendation.** Do not weaken the auth baseline and do not put a TLS proxy in
the measured path for this. WebKit's qualification is a real-origin question, and
ADR 0211 already puts real-origin qualification on the deployed Preview, where
the scheme genuinely is HTTPS and all three constraints hold at once. The
concrete choice, which needs a human decision because it changes what the
promotion tier covers:

- **Recommended** — gate `promotion-webkit` on the rig serving HTTPS, so it is
  skipped on the loopback rig and runs by itself against the Preview, and move
  the WebKit go/no-go line below to Q1/Q2 of the Preview runbook. Firefox
  continues to cover "not-Chromium" on the rig every promotion run.
- Alternative — keep the project as-is and accept that `Promotion verify` is red
  on five WebKit tests until the Preview qualification supersedes it.
- Rejected — serve the rig over TLS (proxy hop in the measured streaming path,
  plus per-request crypto on a two-vCPU runner, both inside the timing budgets),
  or drop `useSecureCookies` for the rig (a change to the shared security
  baseline for a test).

Nothing has been changed in the tier pending that decision.

### The two diagnostics the browser cannot record

ADR 0210 lists query time, RSC payload, client bundle, request fan-out, server
work, and mutation latency as recorded diagnostics. #310 captures all of them
except **query latency** and **server work**: the application emits no
`Server-Timing` header and has no route or query spans, so a browser cannot
attribute a slow completion to the database rather than to rendering.

Nothing here changes that, deliberately. Closing it means instrumenting the
server, which is a product change rather than a qualification step, and ADR 0210
keeps both of these as diagnostics rather than gates — neither can fail this
candidate. What the deployment does give, for free and without new tooling, is
the same information at a coarser grain: Vercel's function duration and latency
views per route, which are already the observation signal ADR 0211 names. Read
them during the observation window (below) and treat a route whose function
duration is out of line with the rest as the place instrumentation would go
next, not as a reversal trigger.

### Running the full tier in CI

`.github/workflows/promotion-verify.yml` — **Promotion verify**. It calls the
same `reusable-verify.yml` every pull request calls, with
`full_browser_matrix: true`, which switches the browser install to
`chromium firefox webkit` and the run to `pnpm test:instant:full`. It is a
separate workflow because `pr-verify.yml`'s change detection and concurrency
group are both keyed on a pull-request number and it always requests the routine
tier. `scripts/instant-matrix-ci.test.ts` pins the shape.

**It has never run.** The wiring landed with this record and no execution exists
yet, so its first run is itself part of the gate rather than a formality: that
run installs three engines from a cold cache (its Playwright cache key is `all`,
not `chromium`, so the first one is a guaranteed miss — which is why the full
tier's `timeout-minutes` is 30 rather than 15), and it is the only place WebKit
has ever executed against this candidate. Treat a first run that fails on
installation, timeout, or WebKit as a finding about the candidate until proved
otherwise.

It has two triggers, and **for this upgrade only the label one works**:

- **Label** — apply `full-browser-matrix` to the pull request. A `pull_request`
  workflow is defined by the *head* branch, so this works on a candidate branch
  that has never been on `main`. The label does not exist yet; create it once:

  ```bash
  gh label create full-browser-matrix \
    --description "Run the full three-engine Instant Interaction matrix" \
    --color 0E8A16
  ```

- **`workflow_dispatch`** — Actions → Promotion verify → Run workflow, against any
  branch. GitHub only offers a dispatch for workflows that already exist on the
  default branch, so this one becomes available after this file lands on `main`.
  It is the trigger for re-promotions and for the next candidate.

**What a green label run is evidence about.** A `pull_request` run checks out the
*merge* ref — head merged into base — so the result is a statement about that
combination, not about the head commit alone. It is invalidated by a push to the
branch *and* by a move on `main`. `types: [labeled]` fires on the label and not
on subsequent commits, so neither invalidation re-runs anything: remove the label
and add it again. That is deliberate — the run is expensive and should be asked
for rather than inherited — but it means a stale green is possible, so record the
run URL together with the head SHA and base SHA it covered, and re-read both
before crediting it.

**It cannot become a required status check.** A required check must report on
every pull request; this one only starts when a label is applied, so requiring it
would leave every unlabeled pull request waiting on a run that never begins. The
`needs.verify.result != 'skipped'` guard in the gate job has the same shape: on a
wrong-label event the whole workflow skips rather than reporting a pass against a
matrix that never executed. Enforcement is therefore the recorded run, not branch
protection.

## Preview qualification runbook

Preconditions: the pull request for the branch is open, its Vercel Preview is
`READY`, and a green `Promotion verify` run is recorded for the branch's current
head and base.

The Preview is not a second copy of the matrix. The matrix needs a deterministic
seeded fixture, two synthetic owners, a frozen clock, and no external network —
a deployed environment satisfies none of those, which is why ADR 0210 keeps it
local and in CI. What the Preview uniquely answers is everything the local rig
*cannot*: a genuine HTTPS origin, Better Auth through a browser, Vercel's static
router resolving the segment-prefetch rewrites, Vercel's file tracing, and Eve's
generated Build Output routes.

Record the outcome of each step in the pull request before merging.

### Q0 — Establish the Preview

```bash
vercel ls --scope nick-neely            # newest Preview for this branch
vercel inspect <preview url> --scope nick-neely
```

Confirm before touching anything else:

- the Preview's `DATABASE_URL` is the branch-scoped Preview override, **not**
  production (`vercel env ls preview --scope nick-neely` shows `DATABASE_URL`
  and `BETTER_AUTH_URL` scoped to `ship/issue-300`); and
- that database's schema is current (`pnpm db:check` clean on the branch, and the
  Preview database has had migrations applied).

Everything below writes data. If the Preview points at production, stop: the
mutation and two-owner steps are not safe to run.

Note that `REDIS_URL` is shared between Preview and Production. Sessions live in
Redis, so a Preview sign-in shares a session store with production while using a
different database. This predates the upgrade and is not a rollback trigger, but
it means a confusing Preview session is a plausible false positive for the
sign-in-loop trigger — re-read it against production before acting.

### Q1 — Better Auth on a real origin

The local rig injects a minted session and never signs in through a browser
(`docs/verification/nextjs-16-3-instant-navigation.md`, "The rig"). This step is
the first time the browser drives Better Auth over genuine HTTPS under the
Preview.

1. In a clean profile, open the Preview root signed out. Only the neutral branded
   access-check state may appear — no product navigation, no owner data, no
   destination name.
2. Sign in through each configured entry point (email, GitHub, Google).
3. Confirm one sign-in lands on Today and stays there. Reload twice. **A second
   redirect back to sign-in is the sign-in-loop trigger.**
4. Sign out, then open a deep link (`/people`, a person URL) signed out and
   confirm it resolves to sign-in rather than a prefetched product shell.
5. With a *pending* (not admitted) account, confirm the pending-access
   destination renders and no admitted shell flashes first.

### Q2 — Critical navigation on the deployed router

Signed in as an admitted owner, on the Preview, with the network panel open:

1. Walk Today → People → person detail → Today, then the mobile bottom bar
   (Today → Review, Menu → Actions, People → person detail) at a phone viewport.
2. Each destination must show its truthful shell immediately — heading and
   geometry, no blank frame, no spinner-only page, no frozen navigation — and
   then settle to authoritative content with no Shaped Reserve left behind.
3. In the network panel, confirm the shell prefetch requests carrying
   `next-router-segment-prefetch` return **200, not 404**. This is the one
   routing path the local rig cannot exercise:
   `segmentPrefetchRewrites()` returns `[]` off Vercel, so the deployed rewrite
   rules run here for the first time. A 404 wave means every click pays for a
   full RSC fetch — the same failure #310 fixed locally, re-appearing on the
   deployed router.
4. Keep the browser console open for the whole walk. Any hydration error,
   `ERR_MODULE_NOT_FOUND`, or chunk-load failure is the hydration/module
   trigger — this is the step that would catch the reported 16.3 Turbopack file
   tracing regression, which no local build can reproduce.
5. Mobile Today → Review is the known network-bound commit
   ([#310's finding](./nextjs-16-3-instant-navigation.md#finding-review-has-no-reusable-shell-to-commit-from)).
   Under real latency it is the row most likely to feel slow. Judge it against
   "blank or frozen", not against 100 ms; record how it feels either way, because
   ADR 0210 says the decision deserves re-reading before promotion.

### Q3 — Two-owner privacy and cache isolation

Two admitted accounts on the Preview database, two browser profiles, A first so
that B always reads a warm cache:

1. As A, open Today, People, a person detail, Actions, Review.
2. As B, immediately open the same routes. B must never see one of A's records,
   counts, or names — including in a shell, a cached region, or a stale
   projection.
3. As B, request A's person URL directly. It must be **byte-identical** to a
   person id that does not exist: same status, same rendered result, same
   timing shape. A distinguishable response is an authorization leak.
4. As B, mutate one Action; reload as A. A's view must be unchanged.
5. Sign B out, sign A back in in the same profile, and confirm no B content
   survives in a cached region.

Any hit here is the owner-data-leak or cross-owner-cache trigger, and it
disqualifies the candidate before merge rather than after promotion.

### Q4 — Mutation reconciliation

1. Complete an Action. The acknowledgement must be immediate and the row must
   settle to the authoritative state, not snap back.
2. Reopen it. Reload. The restored row is present exactly once. (Locally a
   stale Resolved projection duplicates it for ~150–200 ms after reload before
   self-healing; brief duplication is known, permanent duplication is not.)
3. Create a record (a person, a captured note) and confirm it stays visibly
   pending until the server confirms, then appears authoritatively on the next
   read of the destination collection.
4. Accept one Review suggestion and confirm the proposal and its destination
   collection reconcile together.
5. Trigger one failure — go offline, act, come back — and confirm the input is
   preserved, the projection is restored, and nothing was silently queued.

A write that does not read back is the reconciliation trigger.

### Q5 — Eve routing and streaming

Eve is out of scope for behavior change, but it is a deployment seam: `withEve`
generates Build Output services and routes only under `VERCEL`, so this is the
first environment where its routing exists at all.

1. Open Eve on the Preview, send one ordinary prompt, and confirm the response
   streams token by token rather than arriving as one block or hanging.
2. Confirm `/eve/v1/*` requests return 2xx in the network panel.
3. Check Vercel function logs for the Preview for routing, module, or cache
   errors.

Any of those failing is the Eve-routing trigger.

### Q6 — Sweep the Preview's function logs

After Q1–Q5, read the Preview's function logs end to end. Route errors, module
resolution errors, cache errors, and unexpected 5xx are all findings even where
the browser looked fine.

## Go/no-go rollback-trigger checklist

Version 1 — 2026-07-25, for candidate `16.3.0-preview.9`.

The ten triggers ADR 0211 names, each marked by how far it can honestly be
proved before real traffic. Every one reverses to the same place: promote
`dpl_EPFJFXRhbc7dFxqGXfuhHRCJ7Tnx` with the command in
[The reversal target](#the-reversal-target).

Legend — **L** tested locally (automated, on this branch — which means Chromium
desktop and mobile plus the reduced desktop Firefox tier; **never WebKit**, which
has only ever run in CI); **P** exercisable against the Preview (the runbook step
that does it); **O** observe-only (only production traffic can show it).

Row 0 is not one of ADR 0211's triggers. It is the precondition the local column
depends on, and it leads because it is the only line here that has never been
executed at all.

| # | Trigger | Class | Proof | Verdict |
| --- | --- | --- | --- | --- |
| 0 | *(precondition)* `Promotion verify` green — the only WebKit evidence that exists | gate | Record the run URL and the head and base SHAs it covered. It cannot be a required status check (label-only trigger; see above), so the recorded artifact **is** the enforcement. **Blocked:** run 30171146025 (head `f7fbcac`) is green on Chromium and Firefox and red on all five WebKit specs, which cannot be admitted on the loopback rig at all — see [the finding](#finding-webkit-cannot-hold-the-rigs-session-cookie-open-decision). This row cannot be ticked until that decision is made; if WebKit moves to the Preview, so does this row. | ☐ |
| 1 | Credible owner-data leakage | immediate | **L** `owner-isolation.spec.ts` (warm cache across owners; unauthorized ≡ missing) · **P** Q3 · **O** | ☐ |
| 2 | Admission or authorization bypass | immediate | **L** `admitted-route.contract.test.ts`, `src/lib/access/*.test.ts`; matrix arrives only through `[data-admitted]` · **P** Q1.1, Q1.4, Q1.5, Q3.3 · **O** | ☐ |
| 3 | Destructive write corruption | immediate | **P** Q4 (non-destructive writes only — permanent deletion and revocation are deliberately *not* exercised against a shared environment) · **O** | ☐ |
| 4 | Cross-owner cache contamination | immediate | **L** `owner-isolation.spec.ts` (B always reads A's warm cache) · **P** Q3.2, Q3.5 · **O** | ☐ |
| 5 | Reproducible sign-in loop | reversal | **P** Q1.3 — *not* provable locally: the matrix injects a session and never signs in through a browser · **O** | ☐ |
| 6 | Blank or frozen critical navigation | reversal | **L** Chromium matrix (19 rows) + Firefox smoke (3): shell ≤ 100 ms, CLS ≤ 0.01, no reserve left; WebKit only via row 0 · **P** Q2.1–Q2.2 · **O** | ☐ |
| 7 | Unusable streamed content | reversal | **L** same rows: each asserts authoritative owner content and that no Shaped Reserve remains; WebKit only via row 0 · **P** Q2.2, Q5.1 · **O** | ☐ |
| 8 | Hydration or module failure | reversal | **L** per-context runtime errors asserted empty (Chromium + Firefox) · **P** Q2.4 — Vercel file tracing and chunk loading only exist there · **O** | ☐ |
| 9 | Mutation reconciliation failure | reversal | **L** `action-reconciliation.spec.ts` (optimistic ack + authoritative settle, both viewports) · **P** Q4 · **O** | ☐ |
| 10 | Eve routing failure | reversal | **P** Q5 — *not* provable locally: the fixture forbids model calls and external network, and `withEve` only generates routes under `VERCEL` · **O** | ☐ |

Reading it:

- **Immediate** (1–4) reverses on first credible evidence. Do not wait for a
  second occurrence, and do not debug in production first.
- **Reversal** (5–10) reverses when reproducible. A single transient
  infrastructure error is investigated, not reversed — unless it repeats or
  reproduces.
- Performance diagnostics alone never trigger reversal. They trigger it only
  when they become a user-visible breach of the Instant Interaction contract,
  which lands as #6 or #7.
- Two triggers, **5** and **10**, have no local proof at all and one, **8**, has
  no local proof of the deployment-specific half. If the Preview steps that
  cover them are skipped, the candidate is being promoted on faith for those
  three.
- Row **0** is what makes the **L** column mean three engines rather than two.
  Without it, WebKit is untested everywhere and 6, 7, 8, and 9 are Chromium and
  Firefox claims wearing a cross-engine label.

## Promotion

Unchanged, and deliberately so — ADR 0211 forbids adding a canary, shadow
traffic, a second approval, automated rollback, or a new monitoring stack.

The upgrade pull request **is** the human go/no-go. Merging it means the owner
has read the checklist above with every box ticked. After merge,
`.github/workflows/production-migrations.yml` runs on its own: it waits for the
staged Vercel production build for the merged SHA, applies migrations if any
schema paths changed, passes `Production Release Gate`, and promotes. There is
no upgrade-specific post-merge job.

Before merging, confirm: `pnpm verify` green; `FALLOW_AUDIT_BASE=origin/main pnpm
fallow:ci` clean against fresh coverage (CI's own Fallow step resolves its base
to the branch's upstream and is nearly blind on a pushed branch — see
[the Fallow baseline note](./nextjs-16-3-fallow-baseline.md)); `Promotion verify`
green on the merge commit's tree; every runbook step recorded; the reversal
deployment still `READY`; and the migration row above still empty.

## Post-promotion smoke and observation

Start the clock when the promotion step reports success.

**Immediately — non-destructive smoke** (ADR 0211's list, in order). Nothing
here deletes, revokes, or sends anything externally:

1. Sign in on production. Land on Today, reload, stay signed in.
2. Today: shortlist renders, no blank region, no stuck reserve.
3. People: bounded list renders.
4. A person detail: core profile and pane counts render; open one inactive pane.
5. Actions: active projection renders; complete one Action and reopen it.
6. Review: the selected composition renders.
7. Eve: send one ordinary prompt and watch it stream.

Console open throughout; any hydration or module error is trigger 8.

**First hour — active observation.** Existing Vercel views only:

- deployment status and build/runtime logs for the promoted deployment;
- function error count and rate, watched against the previous hour;
- function latency (p50/p95) against the same;
- any 5xx on the product routes.

Repeat the smoke's first five steps once mid-hour. Record the time the window
opened, anything unusual, and the verdict at the end.

**Through 24 hours — heightened observation.** Check function error and latency
signals a few times across the day rather than continuously, re-read the
checklist after each real session of use, and keep
`dpl_EPFJFXRhbc7dFxqGXfuhHRCJ7Tnx` retained and reversible for the whole window.
Close the window explicitly: record that 24 hours passed with no trigger fired,
after which the known-good deployment stops being an active rollback target.

## The next version is a new candidate

**Any later Next.js Preview, canary, or stable release is a separate exact-pin
upgrade on its own pull request, and it repeats this entire qualification.** It
does not float into this release, and it is not a lockfile refresh.

Concretely, for the next version bump:

1. New branch, new pull request, both `next` and `@next/playwright` pinned to the
   same exact version, exact lockfile committed. No `preview`, no `canary`, no
   caret, no automatic update.
2. Re-record the reversal target — after this promotion the known-good
   deployment is the 16.3 one, not
   `dpl_EPFJFXRhbc7dFxqGXfuhHRCJ7Tnx`.
3. `pnpm verify`, `Promotion verify` (full three-engine matrix), and the whole
   Preview runbook again.
4. A fresh copy of the go/no-go checklist, version-stamped for that candidate.

The same requirement is stated in ADR 0211 and in
[the agent tooling guide](../agents/nextjs-agent-tooling.md#version-changes-are-new-candidates),
which is where an agent changing the pin is most likely to be looking.
