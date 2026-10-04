# Runbook: Temporary Suspension

Deny an account admission while a review is open, and keep that review moving
(#629, [the suspension decision](../../phase-9b/bounded-usage-and-support-contract.md#suspension-and-termination)).
From the moment the record commits, admission is denied on Web and Eve with no
exceptions. Every session is revoked, so the next sign-in lands in the
restricted area. That area offers export, account deletion, and cancelling
billing, and nothing else. Household memberships are kept, but the member's
Household access is denied.

Nothing in Stripe changes. The subscription stays active, invoices are paid,
and dunning runs as usual. The suspended paid time is compensated once, by the
[Suspension Credit](suspension-credit.md), when the suspension ends.

## Trigger

- Opening: the operator needs to review an account, for example for suspected
  abuse or a security concern, and admission must stop meanwhile.
- Renewing: the open suspension's internal review deadline arrives and the
  review is not finished. A review never ends in an automatic termination.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The account's id (see the [operations README](../README.md#operator-actions)).
3. The account is not terminated. A terminated account is refused.
4. For opening: an internal reason. It is never shown to the customer.

## Steps

1. **Suspend:**

   ```sh
   pnpm --filter @tendnote/web operator suspend <user id> <reason>
   ```

   The rest of the line is the reason. It prints `suspensionId`,
   `suspendedAt`, `reviewDeadline` (ten business days, skipping weekends), and
   `resumed`. `resumed: true` means a suspension was already open. It is
   unchanged and keeps its original reason, and its sessions were revoked
   again.
2. **Tell the customer** from the support mailbox that the account is under
   review and they will hear back by the review deadline. The restricted page
   already says the account is under review. Name no reason that would
   prejudice the review.
3. **At each review deadline**, decide the review: [lift](lift-suspension.md)
   the suspension, [terminate](termination.md) the account, or, if it is not
   decided, renew the deadline:

   ```sh
   pnpm --filter @tendnote/web operator renew-suspension <user id>
   ```

   It prints `suspensionId`, `previousDeadline`, and the new `reviewDeadline`,
   ten business days from now. The renewal stores no reason, so write the
   reason for renewing as an internal note on the support thread, until
   [#740](https://github.com/nick-neely/tendnote/issues/740) records it. Send the customer an update with the new date.
   The customer hears from the operator at least every ten business days while
   the account stays under review. Renewing over and over does not license an
   indefinite suspension.

## Record produced

A suspension record naming the account, the reason, the time, and the review
deadline, written before sessions are revoked and journaled as a `suspension`
afterwards. Each renewal adds its own record of the new deadline and the time.
The renewal stores no reason.

## Verification

- Against production's database:
  `select id, suspended_at, review_deadline, lifted_at from temporary_suspensions where user_id = '<user id>' order by suspended_at desc limit 1;`
  shows the open suspension, with `lifted_at` empty.
- Signing in as the account lands on the restricted page titled "Your account
  is under review".

## Rollback

[Lift the suspension](lift-suspension.md). The lift is the audited end of a
suspension, and it issues the Suspension Credit. The suspension's history is
kept. A failed journal write is finished by running `suspend` again, which
resumes the open suspension.
