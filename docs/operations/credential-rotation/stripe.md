# Runbook: rotate Stripe credentials

Third in the [rotation order](../README.md#credential-rotation). Stripe's
credentials are the secret key (`STRIPE_SECRET_KEY`) and the webhook
endpoint's signing secret (`STRIPE_WEBHOOK_SECRET`). The publishable key is
public and is not rotated. The account and the endpoint are under **Stripe** in
the operations sheet.

## Trigger

An [incident](../incident.md) whose scope includes a Stripe key, the webhook
secret, or the Stripe account, or whose scope is unknown.

## Preconditions

1. The Incident Record is open, and Vercel is already rotated.
2. The operator can sign in to the Stripe dashboard with two-factor
   authentication, in live mode.

## Steps

1. **Close account access.** Change the Stripe account password. Under
   **Team and security**, remove anyone who should not be there, and review the
   security history for the incident window.
2. **Rotate the secret key.** Under **Developers > API keys**, rotate the
   secret key and set the old key to expire **now**. Revoke any restricted key
   that may be exposed.
3. **Store it.** Set the new key as `STRIPE_SECRET_KEY` in Production on the
   web project, and redeploy. Until the redeploy finishes, Stripe calls fail.
   The reconciliation job repairs anything they missed on its next pass.
4. **Roll the webhook signing secret.** In **Workbench > Webhooks**, open the
   endpoint for `/api/stripe/webhook` and roll its secret. Expire the old one
   immediately. Set the new secret as `STRIPE_WEBHOOK_SECRET`, and redeploy.
   Events that fail verification meanwhile are retried by Stripe, and the
   reconciliation job replays thirty days of events.
5. **Check for misuse.** In **Developers > Logs**, filter the incident window
   for requests the product did not make, especially refunds, payouts, and
   changes to the webhook endpoint or bank account. Export them into the
   incident log.

## Record produced

The Incident Record gets the time of each step and any misuse found. It never
gets a key or secret. Stripe's security history records each change.

## Verification

1. In **Workbench > Webhooks**, a delivery after step 4 succeeds. Resend a
   recent event to check.
2. The next cron pass logs no `stripe_reconciliation.failed`.
3. `pnpm --filter @tendnote/web first-value-check` prints `"failed": []`. It
   reads the Checkout prices from Stripe with the new key.
4. A request with the old key fails: `curl https://api.stripe.com/v1/balance -u '<old key>:'`
   returns `401`.

## Rollback

None: an exposed key must not return. A key or secret set wrong is fixed by
setting the right value and redeploying. Stripe retries webhook deliveries,
and the reconciliation job replays what they missed.
