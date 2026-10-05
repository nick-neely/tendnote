# Runbook: Legal Hold

Keep an account's data from being purged until a date (#632,
[ADR 0260](../../adr/0260-a-legal-hold-covers-an-account-and-pauses-only-its-purge.md)).
A hold covers the whole account and pauses only its purge. Until the hold
expires at the start of its date in UTC:

- an owner's own deletion still closes the account and stops billing, but the
  rows stay;
- a Lapsed or Terminated account gets no deletion notice and is not purged.

When the hold ends, the notice sequence resumes from where it stopped. A
retention deadline that passed during the hold is purged on the next pass.
Nothing else about the account changes, and nothing reaches Stripe.

## Trigger

Counsel, under **Counsel**, says an account's data must be preserved: a
litigation hold, a preservation request, or a legal process.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The account's id (see the [operations README](../README.md#operator-actions)).
3. The expiry date from counsel, as `YYYY-MM-DD`. It must be in the future.
   Write it in the operations sheet next to the matter, because a
   [restore](../restore.md) needs it to place the hold again.

## Steps

1. Run:

   ```sh
   pnpm --filter @tendnote/web operator legal-hold <user id> <YYYY-MM-DD>
   ```

   It prints `holdId`, `userId`, and `heldUntil`.
2. If it fails with "is in force but not yet journaled", run the same command
   again until it succeeds. The hold already protects the data, but a restore
   would lose it until it is journaled.
3. To extend a hold, run the command again with the later date. That writes a
   second hold, and the latest expiry governs.

## Record produced

A Legal Hold record naming the account, its expiry, and the time placed,
written and then journaled as a `legal-hold`. The matter and counsel's
instruction stay in the operations sheet, not in the record.

## Verification

- Against production's database:
  `select expires_at from legal_holds where user_id = '<user id>' order by expires_at desc limit 1;`
  shows the expiry.
- A terminated account under the hold shows no deletion date on the restricted
  page. It says the data is kept and nothing has been deleted.

## Rollback

A hold cannot be shortened or lifted early, by design. It ends on its own at
its expiry, and the purge then catches up. A hold placed on the wrong account
keeps that account's data until the date. Tell counsel, and record it in the
operations sheet with the matter.
