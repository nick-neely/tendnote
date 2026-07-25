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

## Rules for the next person

- A baseline is for findings a review consciously accepted. It is never the way to
  land a new one. If the gate blocks your change, the default answer is to fix the
  finding.
- Re-save the pair only at the end of a delivered, reviewed epic, and extend this
  note when you do — an unexplained baseline bump is indistinguishable from hiding a
  regression.
- `ignoreDependencies` currently carries `@next/playwright`, which is pinned ahead of
  its consumer (#310). That entry is temporary and `.fallowrc.jsonc` says so.
- Reproduce the CI verdict with `FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci`.
  Without the variable the base resolves to the branch's own upstream, so a pushed
  branch reports almost nothing.
- The run prints `duplication baseline has N entries but matched 0 current clone
  groups`. That is expected here: the baseline is repo-wide while the audit is scoped
  to changed files, so a changeset that touches no duplicated file matches none of
  them. It is not a sign the baseline is wrong.
