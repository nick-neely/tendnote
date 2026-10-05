# Runbook: Service-Wide Hold

One audited switch that takes the hosted product offline for every account
during an incident of unknown scope
([incident runbook containment](../phase-9b/hosted-runbooks-and-tabletop.md#containment)).
While it is in force:

- Every request to the app gets a `503`, except the Stripe webhook receiver
  (`/api/stripe/webhook`), which keeps recording billing events. A page visit
  gets a static page that links to the status page. Server Functions, API
  calls, Better Auth, Eve, and the Discord interactions endpoint get plain
  text. Nothing behind the page is rendered or read. Static build assets,
  icons, and the PWA files still load, because the proxy never covers them.
  They hold no account data.
- Export and deletion are suspended. The recovery cron stands down
  (`{"status":"held"}`), so the account-deletion sweep, Lapsed purges,
  deletion notices, export expiry, and operator alerts wait. Every queue
  callback redelivers its message later without consuming it.
- A deletion intent committed before the hold waits too. Its twenty-four-hour
  stuck alert counts from the lift, not from the request.

The status page is hosted apart from the product and is never affected. It
is how customers learn about the hold, through the
[Service Notice](../../status/README.md).

The hold is enforced by the proxy on hosted deployments only. Each app
instance re-reads it at most every five seconds, so it takes effect and lifts
within seconds of the record changing.

## Trigger

A Suspected Incident whose scope is unknown, opened under the
[incident runbook](incident.md).
Whenever scope is unknown, place the hold first and investigate after.

## Preconditions

1. **The Incident Record is open**, with the discovery time noted.
2. **Production's environment is on hand.** From `apps/web`, run
   `vercel env pull .env.local --environment=production`. The command reads
   `DATABASE_URL` from it.

## Steps

1. **Place the hold.** The reason is an internal note and must name no
   customer:

   ```sh
   pnpm --filter @tendnote/web service-hold place <reason>
   ```

   The command prints `holdId`, `placedAt`, and `alreadyHeld`. If
   `alreadyHeld` is `true`, a hold was already in force and is unchanged.
2. **Post a Service Notice** under the [Service Notice](service-notice.md)
   runbook. For example:
   "Tendnote is offline while we investigate a problem. Your next update
   will be here." Update it at least once a day while the hold is in force.
3. Contain the incident under the incident runbook: GlitchTip capture, then
   [credential rotation](README.md#credential-rotation) per provider.
4. **Lift the hold** once containment is verified:

   ```sh
   pnpm --filter @tendnote/web service-hold lift
   ```

   The command prints `holdId`, `placedAt`, and `liftedAt`. It fails with "No
   Service-Wide Hold is in force." when nothing was held.
5. Update the Service Notice to say service is restored. Clear it once the
   incident no longer affects customers.

## Record produced

One `service_wide_holds` row holds the reason and `placed_at`. The lift adds
`lifted_at`. At most one hold is open at a time. No Stripe, session, or
account record changes. Note the `holdId` in the Incident Record.

## Verification

- After placing the hold, wait ten seconds, then open the app. It shows
  "Tendnote is offline for now" with a `503`. Run
  `curl -sI https://app.tendnote.com/api/stripe/webhook`. It does not return
  `503`. The webhook rejects an unsigned request, so a `4xx` is expected.
- On the next cron pass, the cron log shows `{"status":"held"}`.
- After the lift, wait ten seconds and confirm the app loads. The next cron
  pass runs in full and catches up on waiting deletions and exports.

## Rollback

Lifting the hold is the rollback, and placing it again undoes a lift.
Nothing else needs undoing. The hold changes no data, and queued messages
are redelivered after the lift.

A restore to a point before the hold brings back a database with no hold
row. If the hold must outlast a [restore](restore.md), place it again on the
restored branch before the swap, with `DATABASE_URL` set to that branch.
