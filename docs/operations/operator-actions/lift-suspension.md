# Runbook: lift a suspension

End a Temporary Suspension and restore admission (#629), then issue its
[Suspension Credit](suspension-credit.md) (#631). The lift is recorded on the
suspension, so its history is kept. Whatever else is true of the account still
applies. An account that lapsed during the review lands in the Lapsed area, not
the product.

## Trigger

The review of a suspended account ends without termination.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The account's id, and the account has an open suspension.
3. The account is not terminated. A terminated account is refused.

## Steps

1. Run:

   ```sh
   pnpm --filter @tendnote/web operator lift-suspension <user id>
   ```

   It prints `suspensionId`, `suspendedAt`, `liftedAt`, `resumed`, and
   `suspensionCredits`. That last field lists one entry per paid invoice the
   suspension overlapped, each with its amount, instrument, and credit note.
   An empty list means the suspension earned no invoice a cent. `resumed: true`
   means the suspension was already lifted, and this run finished it.
2. If the command fails after the lift, run it again. The lift is committed and
   journaled first, so a Stripe failure never leaves the customer suspended.
   Running it again finishes the Suspension Credit. See
   [Suspension Credit](suspension-credit.md).
3. Tell the customer the review is over and access is restored. Say how much
   is credited and where it goes: to the account's credit balance for the next
   renewal (`balance`), or back to the card (`card`).

## Record produced

`lifted_at` on the suspension record, written and then journaled as a
`suspension-lift`. Then one Suspension Credit record per credited invoice,
each written before its credit note.

## Verification

- Against production's database:
  `select lifted_at from temporary_suspensions where id = '<suspension id>';`
  is filled in.
- Every entry in `suspensionCredits` has a `stripeCreditNoteId`, and the credit
  notes appear on the invoices in the Stripe dashboard.
- The customer can sign in to the product, or to the Lapsed area if their
  subscription ended during the review.

## Rollback

[Suspend](temporary-suspension.md) the account again. That opens a new
suspension with a new reason and review deadline. The credit already issued
stays issued: credit notes cannot be withdrawn.
