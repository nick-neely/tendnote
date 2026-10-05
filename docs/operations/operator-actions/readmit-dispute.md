# Runbook: re-admit after a won dispute

Restore Paid Access that a card dispute revoked, once Tendnote has won the
dispute (#617,
[ADR 0248](../../adr/0248-admission-exceptions-live-inside-their-condition.md)).
A dispute revokes Paid Access on its subscription and stops its renewal. The
re-admission grant names that one dispute, so it excepts that dispute alone and
is void against any later one.

## Trigger

Stripe reports a dispute on a Tendnote payment as **won**, and the customer
should have their access back.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The dispute's id (`du_...`), from the Stripe dashboard. Its status there is
   **Won**. Any other status is refused.
3. The dispute is on record in Tendnote. The webhook or the reconciliation job
   records each dispute when it opens. A dispute not yet on record is refused.
   Wait for the next reconciliation pass.
4. The account is not terminated. A terminated account is refused before
   anything is written.

## Steps

1. Run:

   ```sh
   pnpm --filter @tendnote/web operator readmit-dispute <dispute id>
   ```

   It prints `grantId` and `restored`. When `restored` is `false`, it also
   prints a `reason`.
2. Read the result:

   | Result | Meaning |
   | --- | --- |
   | `restored: true` | Paid Access is restored on the same subscription, and its renewal is resumed if the dispute had stopped it. |
   | `reason: subscription_ended` | The grant is recorded, but the subscription has since ended. The customer subscribes again from the Lapsed page. |
   | `reason: still_revoked` | The grant is recorded, but another revocation, such as a refund or a second dispute, still stands on the subscription. Nothing is restored. |

3. Tell the customer the outcome.

## Record produced

A re-admission grant naming the account and the dispute, written and journaled
as a `grant` before Stripe is asked to resume the renewal. The grant is written
once per dispute, so running the command again reuses it.

## Verification

- Against production's database:
  `select * from admission_exceptions where block_kind = 'dispute' and event = '<dispute id>';`
  shows one grant.
- For `restored: true`: the Stripe dashboard shows the subscription renewing,
  with no cancellation scheduled, and the customer signs in to the product.

## Rollback

There is no command to withdraw a grant. A later dispute on the account
revokes Paid Access again, because the grant names only this dispute. If the
access should end, [terminate](termination.md) the account, or
[refund](refund.md) the invoice if a refund is owed.
