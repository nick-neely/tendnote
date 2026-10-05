# Runbook: Refund

Return money for one paid subscription invoice (#617,
[ADR 0249](../../adr/0249-refund-revocation-is-matched-to-its-operator-action-record.md)).
A refund revokes Paid Access on the subscription that invoice paid for, and on
nothing else: the account becomes Lapsed, Stripe ends that subscription so the
customer is never charged again, and the customer gets the content-free refund
confirmation. A fresh subscription made later is unaffected.

## Trigger

- A refund request under the fourteen-day guarantee, eligible by the request's
  arrival time ([support requests](../support-requests.md)).
- Any other refund the operator decides to make.

Never refund from the Stripe dashboard. A refund with no Refund record matches
nothing. It revokes nothing and raises the reconciliation alert.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The invoice's id (`in_...`), from the customer's page in the Stripe
   dashboard. It must be a paid subscription invoice paid by card.
3. The amount in cents, if it is a partial refund. Leave it out to refund the
   whole amount paid, as the guarantee does.

## Steps

1. Run:

   ```sh
   pnpm --filter @tendnote/web operator refund <invoice id> [amount in cents]
   ```

   It prints `refundRecordId`, `stripeRefundId`, and `outcome`. It refuses an
   amount above what was paid, an invoice that belongs to no Tendnote account,
   and an invoice already refunded, naming the earlier refund.
2. Read `outcome`:

   | Outcome | Meaning |
   | --- | --- |
   | `revoked` | Done: Paid Access is revoked, the subscription is ended, and the confirmation was sent. |
   | `already_revoked` | A webhook or reconciliation pass finished it first. Done. |
   | `not_refunded` | Stripe reports the refund failed or was cancelled. Nothing was revoked. The record stays open. Fix the cause in Stripe and run the same command again. |

3. Reply to the customer that the refund is made, or pending if it failed.
   When funds arrive is up to the card issuer.

If the command fails part-way, run it again with the same amount. It resumes
the unfinished record under the same Stripe idempotency key, so Stripe returns
the refund it already made instead of making a second. An unfinished record
for a different amount is refused, naming the amount to use.

## Record produced

A Refund record naming the account, the subscription, the invoice, the payment,
and the amount, written and journaled as a `refund` before Stripe is called.
The Stripe refund carries the record's id in its metadata, and its id is stored
on the record afterwards. The time Paid Access was revoked is stored last.

## Verification

- Against production's database:
  `select stripe_refund_id, revoked_at from refund_records where invoice_id = '<invoice id>';`
  shows both filled in.
- In the Stripe dashboard, the refund is on the invoice's payment, and the
  subscription is cancelled.
- The customer lands on the Lapsed page when signing in. The ninety-day Lapsed
  retention clock and its deletion notices start from here, unless the
  customer subscribes again.

## Rollback

None. Money returned to a card cannot be taken back, and the revoked
subscription has ended. A customer who wants to continue subscribes again
from the Lapsed page, as a new subscription that the refund does not affect.
