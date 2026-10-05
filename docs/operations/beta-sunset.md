# Runbook: open Checkout and run the Beta Sunset (Stage 2)

Step 3 of Stage 2 in the
[private-beta migration and app-subdomain cutover](../phase-9b/private-beta-migration-and-app-subdomain-cutover.md):
one release turns on Checkout and ends every beta grant, so no account is ever
left with neither a beta grant nor a way to pay. The operator's email and
dashboard locations are in the private operations sheet; this runbook never
copies them.

Merging the release that carries `packages/db/migrations/0105_beta_sunset.sql`
applies it to Production through the Production Release Gate. It moves every
`beta_flag` grant to pending with the `beta_ended` reason, Unpaid and with no
retention deadline. Every other source is untouched. An ex-beta account then
lands in the pending area, which says the beta ended and its data is intact,
and offers Subscribe. The migration runs on merge, not when the flag flips, so
the merge itself is the sunset. Do not merge it ahead of the preconditions.

## Trigger

The owner starts launch, after Stage 1 and once the live Stripe webhook is
registered on `app.tendnote.com`.

## Preconditions

1. **The operator is on `manual_grant`.** The operator exemption must be in
   place before the merge, or the migration ends the operator's own access.
   Against the Production database:

   ```sql
   UPDATE access_profiles SET source = 'manual_grant', updated_at = now()
   WHERE status = 'granted' AND source = 'beta_flag'
     AND user_id = (SELECT id FROM "user" WHERE email = '<operator email>');
   ```

   Then confirm `SELECT source FROM access_profiles WHERE user_id = ...`
   returns `manual_grant`.
2. **The live Stripe webhook and reconciliation are verified** on
   `app.tendnote.com`.
3. **The `private-beta-access` flag targets nobody.** A flag that still
   targets an account grants it `beta_flag` again on its next request, undoing
   the sunset for that account.

## Steps

1. Merge the release. Wait for the Production Release Gate status to pass.
2. Turn the `checkout` flag on for everyone.

## Record produced

None beyond the database itself: each ex-beta profile carries
`pending_reason = 'beta_ended'` until a later grant clears it. Write the
sunset date in the operations sheet under **Vercel**.

## Verification

1. `SELECT count(*) FROM access_profiles WHERE source = 'beta_flag'` returns 0.
2. The operator still reaches Home.
3. Any ex-beta account (`pending_reason = 'beta_ended'`) has no
   `retention_deadline`, and its pending area shows the beta-ended line with
   Subscribe.

## Rollback

Until the first non-operator account is admitted, turn the `checkout` flag off.
Ex-beta accounts stay pending: the migration is not reversed, and their pending
area keeps the beta-ended line without Subscribe. The operator stays in through
`manual_grant`.
