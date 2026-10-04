# Runbook: Suspension Credit

Compensate the paid time a Temporary Suspension denied, and the paid time a
Termination closed (#631, #739,
[ADR 0249](../../adr/0249-refund-revocation-is-matched-to-its-operator-action-record.md),
[the billing policy](../../phase-9b/temporary-suspension-billing-policy.md)).
There is no separate command. The credit is issued by the
[lift](lift-suspension.md) that ends a suspension, or by any
[termination](termination.md). This runbook covers checking a credit and
finishing one that failed part-way.

For each paid invoice whose period the suspension overlapped, one credit note
credits the invoice's subscription line by the time-based amount, when that is
at least one cent. A termination adds the unused remainder to the period end,
on the same credit note. A termination that ends no suspension credits that
remainder alone, on a record that names the termination and no suspension.
Stripe takes the line's discounts off the credited amount, and adds its tax,
in proportion. The money goes:

- to the customer's **balance**, when the subscription will renew and so
  produce an invoice that uses it;
- back to the **card**, when the subscription is cancelled or ended, or the
  exit is a termination.

A Suspension Credit never revokes Paid Access, even when it refunds the card.

## Trigger

- A `lift-suspension` or `terminate` run printed `suspensionCredits`: check
  them.
- A `lift-suspension` or `terminate` run failed after its lift or termination
  committed, during the credit: finish it.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The account's id, and the exit that should be credited.

## Steps

1. Read the `suspensionCredits` the exit printed. Each entry has
   `suspensionCreditId`, `invoiceId`, `suspendedAmount`, `remainderAmount`,
   `amount` (the credit note's total with tax), `instrument`, and
   `stripeCreditNoteId`.
2. If the run failed, or any entry has no `stripeCreditNoteId`, run the same
   exit command again:

   ```sh
   pnpm --filter @tendnote/web operator lift-suspension <user id>
   pnpm --filter @tendnote/web operator terminate <user id> <reason>
   ```

   Run only the one that was the exit. It resumes each unfinished record with
   its stored amount and instrument, finds a credit note a lost response left
   behind instead of creating another, and never credits an invoice twice.
3. If it fails with "has more than one subscription line", stop. The action
   credits exactly one line per invoice and cannot finish this account. Do not
   credit by hand in the Stripe dashboard. A card refund with no record would
   raise the unmatched-refund alert. Open a GitHub Issue with no customer
   details, and tell the customer the credit is pending.

## Record produced

One Suspension Credit record per credited invoice, naming the suspension, the
termination if there was one, the invoice and its line, the suspended and
remainder amounts, the total, and the instrument. Each is written and
journaled as a `suspension-credit` before its credit note is created. The
credit note carries the record in its metadata, and its id, and any card
refund's id, are stored on the record afterwards.

## Verification

- Against production's database:
  `select invoice_id, amount, instrument, stripe_credit_note_id from suspension_credits where user_id = '<user id>' order by requested_at desc;`
  shows a credit note id on every record of this exit.
- Each credit note appears on its invoice in the Stripe dashboard. A `card`
  credit shows a refund. A `balance` credit shows on the customer's credit
  balance.

## Rollback

None. A credit note cannot be withdrawn, and a card refund cannot be taken
back.
