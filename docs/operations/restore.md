# Runbook: restore the service

A whole-service restore to a point inside the seven-day Backup Window
([ADR 0250](../adr/0250-one-backup-window-bounds-recovery-and-the-deletion-tail.md),
[the Backup Window decision](../phase-9b/backup-window-and-deletion-tail.md)).
The restored data never brings back a deleted account or household. It never
repeats a completed email or export, and it never keeps a session from before
the restore.

Recovery is per service, not per account. The Neon project, the Blob store, the
Redis service, and the Stripe account are under **Neon**, **Vercel Blob**,
**Redis**, and **Stripe** in the operations sheet. This runbook never copies from
the sheet.

The scripted steps run from a checkout. Each one names the database it acts on
before it starts. Check that name every time, because `.env.local` holds
production's URL:

```sh
pnpm --filter @tendnote/web restore <step>
```

Each step prints a JSON report and exits non-zero when the report is not `ok`.
A non-zero exit means stop and read the report before going on. Every step is
safe to run again. `DATABASE_URL` decides which database a step acts on, and
each step below names it. The Recovery Journal, Redis, and Stripe are always
production's, because a restore rolls none of them back.

## Trigger

Data loss or corruption in production that the operator decides to repair by
restoring the whole service, opened as an Incident Record under the incident
runbook. Also the restore drill, run against an isolated copy of production.

## Preconditions

1. **The restore point is inside the Backup Window.** Pick it from the
   incident timeline as an RFC 3339 UTC time, before the damage. It must be less
   than seven days old when the branch is created.
2. **The checkout matches production.** Check out the commit Production
   runs, then run `pnpm install`.
3. **Production's environment is on hand.** From `apps/web`, run
   `vercel env pull .env.local --environment=production`. The steps read
   `BLOB_READ_WRITE_TOKEN`, `REDIS_URL`, and `STRIPE_SECRET_KEY` from it.
   `DATABASE_URL` is always given on the command line, which takes precedence
   over the file.
4. **The Neon CLI is signed in** to the project under **Neon**. Note the
   production branch's connection string as `PROD_URL`.
5. **Nothing else is changing production.** No deploy, migration, or Operator
   Action is in flight. Hold them until the end of this runbook.

## Steps

The times below are examples. Use the restore date in branch names.

1. **Restore into an isolated branch, with outbound held from creation.**
   Create the branch from the restore point, bring its schema up to the code
   production runs (a restore point can predate a migration), then hold
   outbound on it before anything else connects:

   ```sh
   neon branches create --project-id <project> --name restore-2026-10-04 \
     --parent 2026-10-03T21:00:00Z
   RESTORE_URL=$(neon connection-string restore-2026-10-04 --project-id <project>)
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/db db:migrate
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/web restore pause-outbound
   ```

   The pause is a row in the database, so the branch carries it. The cron, every
   queue consumer (and with them push), and every email send stand down on any
   deployment that reads this data, until step 11. Connect no deployment to the
   branch: only these steps touch it before the swap.

2. **Stop production writes.**

   ```sh
   DATABASE_URL=$PROD_URL pnpm --filter @tendnote/web restore stop-writes
   ```

   This holds outbound on production, makes every new connection read-only, and
   ends the open ones. It then journals a Deletion Record for every account
   deletion still pending in production (`journaledIntents`), so a deletion
   whose own journal write had failed is not lost at the swap. Customers see
   errors from here until the swap in step 10.

   Queue messages wait while outbound is held, and the platform keeps a message
   for 24 hours by default. Resume outbound (step 11) within a day of this step.
   If that is not possible, a reminder push may be lost; note it in the Incident
   Record.

3. **Wait ten minutes.** That is longer than the longest function
   (`maxDuration = 300` on the cron), so any write that started before step 2
   has either finished or failed, and any journal write it began has landed.
   The drill measures whether ten minutes is enough.

4. **Write the cutover marker and drain the journal.**

   ```sh
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/web restore cutover
   ```

   This writes `journal/_cutover/<time>.json` and waits until a listing shows
   it. Record `listableAfterMs`, the measured Blob listing delay.

5. **Apply every Deletion Record, including late ones.**

   ```sh
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/web restore apply-deletions
   ```

   Every record in the journal is applied, oldest first, whatever its time:
   accounts by deleting the account row, so the household-aware disposition
   runs, and households through the ADR 0221 erasure. The step lists again until
   nothing new appears. A `failed` record is a subject the restored data cannot
   purge, such as a household that was never dissolved. Investigate it as a
   Suspected Incident and do not swap while one stands.

6. **Mark fenced effects complete.**

   ```sh
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/web restore mark-fences
   ```

   Every email fence is copied into the restored database, so a send whose key
   is fenced completes without sending, whichever job or state change would
   repeat it. Each restored export job that a fence names is marked delivered
   and expired, and its owner can request a new one. Reminders are never fenced,
   so a reminder may repeat. That is accepted (ADR 0250).

   Step 7 copies the fences again before its Stripe replay, so the replay never
   repeats an email that already went before the restore. That copy is
   idempotent, so the order cannot be got wrong.

7. **Reconcile admission from Stripe and the operator records.**

   ```sh
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/web restore reconcile-admission
   ```

   The Stripe reconciliation job replays thirty days of paid invoices,
   subscription changes, refunds, disputes, and closed dunning windows into the
   restored data. A `failed` entry at stage `announce` or one from a
   confirmation is an email that never went before the restore. Outbound is
   held, so it does not go now. Note it in the Incident Record.

   The step is `ok` when the replay ran cleanly. Separately, `missing` lists,
   oldest first, every journaled Operator Action the restored data has no
   record of. The list stays the same when the step is re-run, because a
   re-performed action gets a new id. Each one happened after the restore point. Journal
   records hold no reason, amount, or invoice, so nothing is re-applied
   automatically. Handle each one by kind:

   | Kind | Action |
   | --- | --- |
   | `suspension` | Re-run `operator suspend <account> <reason>`. It moves no money. |
   | `grant` | Re-run `operator extend-dunning` or `operator readmit-dispute`, whichever the account's billing state shows it was. |
   | `ceiling-override` | Re-run `operator raise-ceiling` with the original category and amount. |
   | `termination` | Do not re-run: Stripe already stopped renewal and issued any credit. Run `operator suspend <account> "restore: termination"` so the account stays closed, and record it in the Incident Record. |
   | `suspension-lift` | Do not re-run, because it would issue the Suspension Credit again. Re-record the lift without the credit by running this against `RESTORE_URL`: `update temporary_suspensions set lifted_at = '<at>' where id = '<id>' and lifted_at is null`. Confirm that exactly one row was updated. `<at>` is the lift entry's time. `<id>` is the lift entry's `actionId`, unless this restore re-ran the missing `suspension` action, in which case use the suspension id that command printed. |
   | `refund`, `suspension-credit` | Do not re-run, because the money already moved in Stripe. Record each in the Incident Record. A refund also shows as an unmatched-refund alert until it is recorded. |

Re-recording terminations, refunds, and Suspension Credits without repeating
their Stripe effect is
[#723](https://github.com/nick-neely/tendnote/issues/723).

   `unchecked` lists records with nothing to check them against yet, such as a
   Legal Hold. Re-apply each by hand. Run every `operator` command with
   `DATABASE_URL=$RESTORE_URL`.

8. **Invalidate every session.**

   ```sh
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/web restore invalidate-sessions
   ```

   This deletes every session row and every key under `tendnote:better-auth:` in
   production's Redis, then confirms by query that both counts are zero. Everyone
   is signed out, on both the old data and the restored data.

9. **Verify the restored branch.**

   ```sh
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/web restore apply-deletions
   DATABASE_URL=$RESTORE_URL pnpm --filter @tendnote/web restore verify
   ```

   Applying again picks up any Deletion Record that became listable late. The
   verify step reads back six checks: outbound is held; the database accepts
   writes; no Deletion Record's subject is present; every email fence is copied
   in; no fenced export job is left to run; and no session survives in the
   database or Redis. Every check must be `ok`.

10. **Swap.** Restore production from the verified branch, keeping the old state
    under a known name:

    ```sh
    neon branches restore production restore-2026-10-04 --project-id <project> \
      --preserve-under-name production_old_2026-10-04
    ```

    Production keeps its connection string, so deployments pick up the restored
    data without a redeploy. Then, against production:

    ```sh
    DATABASE_URL=$PROD_URL pnpm --filter @tendnote/web restore invalidate-sessions
    DATABASE_URL=$PROD_URL pnpm --filter @tendnote/web restore verify
    ```

    If `the database accepts writes` fails, run `resume-writes` against
    `PROD_URL` and verify again. Sign in as the operator and confirm the data is
    as of the restore point.

11. **Re-enable outbound.**

    ```sh
    DATABASE_URL=$PROD_URL pnpm --filter @tendnote/web restore resume-outbound
    ```

12. **Delete the restore surfaces.** Once verification below passes, delete
    `restore-2026-10-04` and `production_old_2026-10-04`. Both hold deleted
    content. Neither may outlive one Backup Window from the restore, and the
    backup-surface check treats one that does as a Suspected Incident
    (ADR 0250).

## Record produced

The cutover marker in the Recovery Journal, and a restore entry in the
Incident Record (or the drill report for a drill). The entry holds the restore
point, both branch names, the time of each step, every step's printed report,
and the handling of each `missing` Operator Action. Reports hold identifiers
and counts, not content.

## Verification

1. Step 10's `verify` against production is `ok`.
2. An account deleted after the restore point cannot sign in, and its email can
   sign up afresh.
3. The next cron pass (`/api/cron/background-jobs`) completes in the Vercel logs
   with a normal report, not `{"status":"paused"}`. A queue job completes, and
   a reminder push arrives.
4. No email fenced before the restore is received again. In the drill this is
   checked against the Resend log.
5. After step 12, `neon branches list` shows neither restore surface.

## Rollback

- **Before the swap (steps 1 to 9):** abandon the restore. Against `PROD_URL`,
  run `resume-writes` and then `resume-outbound`, and delete the restore branch.
  Sessions invalidated in step 8 stay signed out, which is harmless.
- **After the swap:** restore production from `production_old_2026-10-04` with
  the same `neon branches restore` command and a new `--preserve-under-name`.
  Then, against `PROD_URL`, run `resume-writes`, `invalidate-sessions`, and
  `resume-outbound`. Every restore surface is then deleted under step 12's
  rule.
- **After outbound resumes:** emails, exports, and reminders already sent cannot
  be recalled. Fix forward.
