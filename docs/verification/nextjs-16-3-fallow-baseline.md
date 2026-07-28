# Fallow baseline at the end of the Next.js 16.3 epic

`.fallowrc.jsonc` points the audit gate at `fallow-baselines/nextjs-16-3-health.json`
and `nextjs-16-3-dupes.json`. This note records what that pair accepts, so the
accepted debt stays visible instead of disappearing into a JSON file.

## Why a new pair

The gate runs `gate: "new-only"`, which means a baseline decides what counts as
pre-existing. The previous pair (`phase-7-*`, added by #276) was recorded against
Phase Seven's eleven reviewed slices and had stopped matching: Fallow reported
`duplication baseline has 19 entries but matched 0 current clone groups`. Against
the 183-file changeset from #301–#309 the gate was therefore reporting the entire
standing backlog rather than this epic's regressions, which is the same as having no
gate at all.

The new pair records the state accepted at the end of #301–#309 (all delivered,
reviewed, and closed), the same point in the cycle at which Phase Seven recorded
its own.

One clarification the last rule below expands on: the `matched 0` message is not
by itself evidence of a dead baseline — a *scoped* audit legitimately matches
none of a repo-wide baseline when the changeset touches no duplicated file. What
condemned the Phase Seven pair is that the clones it recorded had been rewritten
out of existence, which a repo-wide run is what shows.

## Fixed, not baselined

These were real findings in the epic's own code and were repaired rather than
accepted:

- **Duplication, all four clone groups** — now zero in the changed scope.
  - `apps/web/src/lib/cache/action-views.ts` repeated "load active Actions, load
    their linked Assets, emit each Action's invalidation tags, map to a view" three
    times. Extracted `toTaggedActionView` and `taggedActiveActionViews`. Both are
    called from inside each `"use cache"` body on purpose: `cacheTag` registers
    against the entry being produced, so hoisting the walk out would silently change
    which tags an entry carries.
  - `packages/db/src/queries/people/drizzle-store.ts` repeated the household
    visibility predicate in `getPersonDetailCore` and `getPersonProfile`. Extracted
    `visibleProfileFollowupsWhere` alongside `selectOwnedPerson` /
    `selectPersonById`, so the count a read gates on and the rows it returns can
    never disagree about who is visible.
  - Two Action-adapter suites repeated the same three module redirects. Extracted
    `apps/web/src/test/action-adapter-mocks.ts`.
- **Dead code, all five issues** — `ContactsImportContent`, `actionMutationScopes`,
  and `RemovalItem` were exported but only used in their own files, so they are now
  module-private; `getCachedReviewQueue` and its private `cachedReviewQueue` had no
  consumer at all and were deleted.
- **One complexity finding** — `MobileShellContent` was above threshold and in the
  dashboard changeset, so its focused-flow machine moved into a `useFocusedFlow`
  hook rather than being accepted.

One gap the `action-views.ts` extraction exposed rather than caused: no test
exercises those `"use cache"` readers end to end, so which tags an entry actually
carries is currently argued from mechanism (`cacheTag` reads its target from the
async context, which propagates across `await`) rather than asserted.
`action-views.test.ts` only pins the contract strings. An integration test around
`getCachedActionTodayViews` asserting the emitted tag set would make read-your-writes
provable instead of reasoned; worth doing before the next change to that file.

## Accepted as debt

> **Superseded in part by [the #311 amendment](#amendment-311-the-baseline-did-not-match-its-own-tree)
> below**, which adds ten findings this list never recorded and removes four in
> three of the files below (`use-server-synced-list.ts`, `in-memory-store.ts`,
> `saved-items-surface.tsx`). Read the two together; the amendment is current.

Fourteen complexity findings are accepted. All are in code delivered by #301–#309
slices that were individually reviewed; none are in the dashboard changeset that
created this baseline. Several carry a high CRAP score, which is complexity times
untestedness — those are the ones worth attention first.

| Finding | Metrics | Severity |
| --- | --- | --- |
| `people/[personId]/page.tsx` → `PersonDetailEnrichment` | 28 cyclomatic, 28 cognitive, 166 lines, CRAP 812 | **critical** |
| `lib/cache/asset-mutation-scopes.ts` → `updateAssetMutationScopes` | 19 cyclomatic, 16 cognitive | moderate |
| `components/person-remove.tsx` → `PersonRemove` | 9 cyclomatic, 15 cognitive, 168 lines, CRAP 90 | high |
| `people/in-memory-store.ts` → `createInMemoryPeopleStore` | 8 cyclomatic, 192 lines, CRAP 72 | high |
| `app/pending/page.tsx` → `PendingPage` | 8 cyclomatic, 56 lines, CRAP 72 | high |
| `actions/assets.ts` → `browseAssetsAction` | 6 cyclomatic, CRAP 42 | moderate |
| `actions/contact-import.ts` → `authoritativeImportResult` | 6 cyclomatic, 8 cognitive, CRAP 42 | moderate |
| `app/sign-in/page.tsx` → `SignInPage` | 5 cyclomatic, CRAP 30 | moderate |
| `lib/use-server-synced-list.ts` → `replacements` and its arrow | 5 cyclomatic each, CRAP 30 | moderate |
| `assets/[assetId]/page.tsx` → `AssetEvidenceStream`, `AssetReviewStream` | 5 cyclomatic each, CRAP 30 | moderate |
| `actions/asset-evidence.ts` → `toEvidenceFields` | 5 cyclomatic, CRAP 42 | moderate |
| `components/saved-items-surface.tsx` → arrow at :202 | 5 cyclomatic, 6 cognitive | moderate |

`PersonDetailEnrichment` is the one that should not stay: 28 cyclomatic across 166
lines with effectively no coverage is where a regression hides. It was left alone
here deliberately — it belongs to the person-detail work, not to the dashboard fix
that recorded this baseline, and refactoring an untested branch-heavy component
blind is how you break it quietly.

## Amendment, #311: the baseline did not match its own tree

Re-saved on 2026-07-25 during the promotion-qualification ticket (#311), the last
of the epic. It was not a routine bump — the pair above did not describe the tree
it was committed against, and the honest gate had been failing ever since:

```
FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci
✗ complexity: 10 findings · 219 changed files
```

Ten findings the baseline had never recorded, in six files, none of them touched
by #310 or #311 — so the gate was red at `42d4d8c` exactly as it was before those
tickets' changes. Every difference is CRAP-based, which is the coverage-dependent
half of the health analysis, so the likeliest cause is that the original save ran
against a coverage file that did not match the tree (an absent or stale
`coverage/coverage-final.json` changes which functions Fallow scores from
measured coverage and which it estimates from export references).

Checks that rule out the alternative — that today's measurement is the wrong one:

- `pnpm fallow:coverage:check` passes, which is this repository's own assertion
  that Fallow is scoring CRAP from matched Istanbul data rather than estimating.
- Two independent `pnpm coverage:ci` runs produce byte-identical health findings,
  so the measurement is not flaky.
- Outside the ten findings added and the four removed, the two baselines are
  identical: same `target_keys`, same runtime findings, same counts for every
  other file.

**Originally recorded in #311.** All ten were CRAP — complexity multiplied by
untestedness — in #301–#309 code:

| Finding | Metrics |
| --- | --- |
| `app/actions/saved-items.ts` → arrow at :132 (`editSavedItemAction`) | 9 cyclomatic, 9 cognitive, CRAP 90 |
| `app/actions/general-actions.ts` → arrow at :210 | 8 cyclomatic, 7 cognitive, CRAP 72 |
| `components/actions-surface.tsx` → `mergeByRevision`, arrows at :61 and :325 | 5–6 cyclomatic, CRAP 30–42 |
| `components/general-action-row.tsx` → arrows at :169 and :219 | 5–6 cyclomatic, CRAP 30–42 |
| `app/actions/saved-items.ts` → `userSafeError` | 5 cyclomatic, CRAP 30 |
| `app/actions/followups.ts` → `createFollowupAction` | 5 cyclomatic, CRAP 30 |
| `packages/db/src/queries/followups.ts` → `createBirthdayFollowupReminder` | 5 cyclomatic, CRAP 30 |

**Paid down in #312 (2026-07-27).** Adapter coverage removed four findings:
`editSavedItemAction` and `userSafeError` in `app/actions/saved-items.ts`, the
edit callback in `app/actions/general-actions.ts`, and `createFollowupAction` in
`app/actions/followups.ts`. The tests exercise session-derived owner scope,
validation failures, explicit-clear versus absent edit fields, and the cache
invalidation paths that make the returned views authoritative.

**Still accepted after #312.** Six lower-priority findings remain: the three in
`components/actions-surface.tsx`, the two in
`components/general-action-row.tsx`, and
`createBirthdayFollowupReminder` in `packages/db/src/queries/followups.ts`.

**No longer findings, and removed** — four, across three files:
`components/saved-items-surface.tsx` (arrow at :202),
`lib/use-server-synced-list.ts` (`replacements` and its arrow, two findings), and
`people/in-memory-store.ts` (`createInMemoryPeopleStore`). All three files appear
in the accepted-debt table above and no longer score above threshold against
matched coverage.

**Server-action adapter debt** — paid in
[#312](https://github.com/nick-neely/tendnote/issues/312).
`app/actions/general-actions.ts` and `app/actions/followups.ts` now have focused
adapter test files, and `app/actions/saved-items.ts` covers the edit and
user-safe-error branches that #311 found. The four corresponding baseline
entries were removed after a fresh coverage-backed measurement; they are no
longer accepted debt.

Re-saved with:

```bash
pnpm coverage:ci
pnpm exec fallow health --coverage coverage/coverage-final.json \
  --save-baseline fallow-baselines/nextjs-16-3-health.json
```

The `--coverage` flag is the load-bearing part. Saving without it is what
produced a baseline the gate could never agree with. Fallow writes the file
without a trailing newline, which Biome rejects, so `pnpm lint` fails until one
is appended.

## Rules for the next person

- A baseline is for findings a review consciously accepted. It is never the way to
  land a new one. If the gate blocks your change, the default answer is to fix the
  finding.
- Re-save the pair only at the end of a delivered, reviewed epic, and extend this
  note when you do — an unexplained baseline bump is indistinguishable from hiding a
  regression.
- Always re-save with `--coverage coverage/coverage-final.json`, from a fresh
  `pnpm coverage:ci`. A baseline saved without it disagrees with the gate about every
  CRAP finding, which is how the pair above went red without anyone noticing.
- Reproduce the CI verdict with `FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci`.
  Without the variable the base resolves to the branch's own upstream, so a pushed
  branch reports almost nothing. #311 set that variable on the CI step itself
  (`reusable-verify.yml`, `Run Fallow audit`), so a green `Verify` now means the
  same thing the local run does; before that change CI was auditing a base that
  was effectively the branch itself.
- The run prints `duplication baseline has N entries but matched 0 current clone
  groups`. That message alone does not tell you whether a baseline is healthy,
  because it is emitted under whatever scope the audit ran with. A **scoped**
  audit (`FALLOW_AUDIT_BASE` set, "N changed files") can legitimately match none
  of a repo-wide baseline: a changeset touching no duplicated file has nothing to
  match. A **repo-wide** run matching (almost) none is the degeneration
  `.fallowrc.jsonc` describes — the recorded clones no longer exist, so the
  baseline gates nothing. The repo-wide check is what separates the two:

  ```bash
  pnpm exec fallow dupes --save-baseline /tmp/dupes-now.json   # then diff
  ```

  Checked on 2026-07-25 (#311): this pair's dupes half matches **64 of its 68**
  entries exactly, so it is live and was deliberately not re-saved. The four
  absent entries are clones that have since been removed.
