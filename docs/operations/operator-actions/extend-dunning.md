# Runbook: extend dunning once

Give a Past Due account more time to pay one failed renewal (#633,
[ADR 0248](../../adr/0248-admission-exceptions-live-inside-their-condition.md)).
An account stays admitted as Past Due for seven days after a renewal fails, and
then the reconciliation job lapses it. The extension moves that one invoice's
window to a number of days past its ordinary close. A later invoice that fails
starts a window of its own that the extension does not cover.

Nothing reaches Stripe. Its payment retries carry on as before.

## Trigger

A Past Due customer asks for more time to pay, and the operator agrees.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The failed renewal invoice's id (`in_...`), from the customer's page in the
   Stripe dashboard. It must be the failed renewal of the account's live Past
   Due subscription.
3. **Stripe's retry schedule outlasts the extension.** In the Stripe
   dashboard, under Billing > Revenue recovery > Retries, the final retry and
   the action after it fall after the new window closes. Otherwise Stripe ends
   the subscription first, and the extension does not stop that.
4. The invoice has not been extended before. An invoice is extended once.

## Steps

1. Run, with the whole number of extra days:

   ```sh
   pnpm --filter @tendnote/web operator extend-dunning <invoice id> <days>
   ```

   It prints `grantId`, `userId`, `invoiceId`, and `extendedUntil`. It refuses
   an invoice that is not the failed renewal of a live Past Due subscription,
   an extension that would already have expired, and a second extension of the
   same invoice. That refusal names the earlier grant and its expiry.
2. Reply to the customer with the new date from `extendedUntil`.

## Record produced

A dunning extension grant naming the account, the invoice, its expiry, and the
time granted, written and then journaled to the Recovery Journal as a `grant`.

## Verification

- Against production's database, the grant exists:
  `select * from admission_exceptions where block_kind = 'dunning' and event = '<invoice id>';`
- The customer's billing notice counts down to `extendedUntil`, not to the
  seven-day close.

## Rollback

There is no command to revoke a grant, and it cannot be shortened. It expires
on its own at `extendedUntil`, and the reconciliation job then lapses the
account if the invoice is still unpaid. A journal write that failed is finished
by running the same command with the same days again, which journals the same
grant again.
