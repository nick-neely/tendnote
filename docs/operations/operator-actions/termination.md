# Runbook: Termination

End an account permanently (#630,
[the termination decision](../../phase-9b/bounded-usage-and-support-contract.md#suspension-and-termination)).
From the moment the record commits, admission is denied on Web and Eve with no
exceptions, and the ninety-day retention clock runs. Every session is revoked,
so the next sign-in lands in the restricted area with export and deletion only.
Household memberships are kept, but Household access is denied.

Then Stripe is asked to stop the subscription renewing. A Past Due
subscription is ended at once instead, so Stripe never retries its failed
renewal against a terminated account. When the termination converts an open
Temporary Suspension, it issues that suspension's
[Suspension Credit](suspension-credit.md): the suspended time plus the unused
remainder to the period end, always back to the card. A termination that
converts no suspension issues no credit.

## Trigger

The operator decides an account must end, usually at the end of a suspension's
review. This is the operator's choice, unlike cancellation or deletion.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The account's id (see the [operations README](../README.md#operator-actions)).
3. An internal reason. It is never shown to the customer.
4. **This is permanent.** Nothing re-admits a terminated account: no
   Operator Action, no new subscription, and no won dispute.

## Steps

1. Run:

   ```sh
   pnpm --filter @tendnote/web operator terminate <user id> <reason>
   ```

   The rest of the line is the reason. It prints `terminationId`,
   `terminatedAt`, `retentionDeadline`, `convertedSuspensionId`,
   `stripeSubscriptionId`, `resumed`, and `suspensionCredits`.
   `stripeSubscriptionId` is empty when the account had no live subscription.
   `resumed: true` means the account was already terminated, and this run
   finished it under its original record, reason, and deadline.
2. If the command fails part-way, run it again. It resumes the stopped renewal
   and the Suspension Credit. See [Suspension Credit](suspension-credit.md).
3. Tell the customer from the support mailbox that their access has ended.
   They can export and delete until `retentionDeadline`, when the data is
   purged, with deletion notices before it. Give the amount returned to the
   card, if any.

## Record produced

A termination record naming the account, the reason, the time, the retention
deadline, and any suspension it converted, written before sessions are revoked
and journaled as a `termination` before Stripe is called. The subscription it
stopped is stored on it afterwards. Then one Suspension Credit record per
credited invoice, each written before its credit note.

## Verification

- Against production's database:
  `select terminated_at, retention_deadline, stripe_subscription_id from terminations where user_id = '<user id>';`
  shows the termination.
- In the Stripe dashboard, the subscription is set to cancel at its period
  end, or has already ended if it was Past Due.
- Signing in as the account lands on the restricted page titled "Your access
  to Tendnote has ended".

## Rollback

None. A termination is permanent, and the money returned cannot be taken back.
There is no built path to reverse one, so a termination made in error stays
in force. Tell the customer, and record what happened in the support thread.
