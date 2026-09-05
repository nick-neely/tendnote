# Person update Undo (#557)

The shared People mutation stores one inverse per person. The Eve result card and
person page use the same authenticated Undo action. ADR 0241 records the contract;
this note records implementation verification on `feat/557-person-update-undo`.

## Verification

- `pnpm verify`: passed (types, lint, full tests, production build).
- After the final complexity refactor: types, lint, production build, focused
  browser behavior, and the real Postgres check passed again.
- `pnpm coverage:ci`: passed after the final product refactor.
- `FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci`: passed with no findings.
- `pnpm db:check`: passed; migration `0081_person_update_undo` is generated and
  descriptively named.
- `pnpm test:browser`: 50 checks passed. The new mobile contract covers readable
  multi-field changes and keyboard Undo; its focused rerun also passed.
- `pnpm test:instant`: 26 of 27 passed initially. The mobile Action complete/reopen
  check timed out waiting for its reopen control; its isolated rerun passed (1/1).
  Person navigation, ownership, and person payload checks passed in the full run.
- The Postgres check (`pnpm --filter @tendnote/db db:person-update-undo:check`)
  passed concurrent edits/Undo, duplicate Undo, transaction rollback, wrong-owner
  rejection, and deletion against synthetic local fixture people.
- A live Eve conversation found the synthetic person, asked for the birthday
  change under Ask mode, rendered the actual change with Undo/View person, and
  restored the prior birthday through the direct Undo button. Reloaded status
  acknowledged the consumed inverse. Next.js reported no runtime errors. The
  temporary person and preview route were removed after verification.

## Review

Standards review found no violations. Spec review found one missed retry
invalidation: `already_undone` now returns affected scopes so a lost first response
can repair caches on retry. The new regression test passed and the reviewer
confirmed resolution. Impeccable's finish review returned `ship`, with no material
visual fixes; desktop and mobile captures covered both recovery surfaces.
