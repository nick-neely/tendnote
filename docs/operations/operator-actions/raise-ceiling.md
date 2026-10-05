# Runbook: raise the Account Ceiling for the current period

Raise one cost category's Account Ceiling for one account, for the Usage
Period running now (#633). When the ceiling is reached, that function pauses
until the period resets
([ADR 0252](../../adr/0252-account-ceilings-count-gateway-reported-cost-at-the-turn-door.md),
[ADR 0254](../../adr/0254-background-and-web-search-ceilings-pause-where-the-spend-happens.md)).
The override applies from the moment it commits and expires when the period
resets, so the next period starts at the plan's ceiling again. Nothing reaches
Stripe.

## Trigger

A customer's function is paused at the Account Ceiling, and the operator
decides to raise it for this period. This is discretionary. A customer who
reaches the ceiling has no right to a raise.

## Preconditions

1. Production's environment is on hand ([operations README](../README.md)).
2. The account's id (see the [operations README](../README.md#operator-actions)).
3. The cost category that paused: `interactive` (Eve turns), `background`
   (work the product runs for the account, such as extraction and snapshots), or `web_search`.
4. The new ceiling in dollars, as a total for the period, not an increment.
   It must be above the ceiling now in force.

## Steps

1. Run:

   ```sh
   pnpm --filter @tendnote/web operator raise-ceiling <user id> <interactive|background|web_search> <dollars>
   ```

   Dollars are written like `20` or `1.75`. It prints `overrideId`,
   `costCategory`, `ceilingUsd`, and `expiresOn`. It refuses an unknown
   category, an account with no Usage Period, and a figure at or below the
   ceiling now in force.
2. Tell the customer the function is available again until `expiresOn`.

## Record produced

A ceiling override naming the account, the category, the new ceiling, the
period it belongs to, and its expiry, written and then journaled as a
`ceiling-override`.

## Verification

- Against production's database:
  `select * from account_ceiling_overrides where user_id = '<user id>' order by granted_at desc limit 1;`
  shows the override.
- The customer's paused function works again without waiting for the reset.

## Rollback

An override cannot be lowered or withdrawn. It expires on its own when the
period resets. To raise it further, run the command again with a higher
figure. Running it with the same figure journals the same override again,
which is how a failed journal write is finished.
