# Runbook: rotate Resend credentials

Fourth in the [rotation order](../README.md#credential-rotation). Resend sends
every account email and receives the support mailbox's `email.received`
webhook. Its credentials are the API key (`RESEND_API_KEY`) and the webhook's
signing secret (`RESEND_WEBHOOK_SECRET`). The account, the sending domain, and
the webhook are under **Resend** in the operations sheet.

## Trigger

An [incident](../incident.md) whose scope includes a Resend key, the webhook
secret, or the Resend account, or whose scope is unknown.

## Preconditions

1. The Incident Record is open, and Vercel is already rotated.
2. The operator can sign in to Resend with two-factor authentication.

## Steps

1. **Close account access.** Change the Resend account password. Remove any
   team member who should not be there.
2. **Replace the API key.** Under **API Keys**, create a new key with sending
   access to the sending domain only. Set it as `RESEND_API_KEY` in Production
   on the web project, and redeploy. Then delete the old key and any other key
   that may be exposed. Between the delete and the redeploy, sends fail, and
   their jobs retry or record a delivery failure.
3. **Replace the webhook secret.** Under **Webhooks**, create a new webhook to
   the same `/api/resend/webhook` URL for `email.received`. Set its signing
   secret as `RESEND_WEBHOOK_SECRET`, redeploy, then delete the old webhook.
4. **Check for misuse.** In **Emails**, filter the incident window for sends
   the product did not make, and check that the domain's DNS records under
   **Domains** are unchanged. Export the findings into the incident log.
   Record counts and ids only, never message content.

## Record produced

The Incident Record gets the time of each step, the key names deleted, and any
misuse found. It never gets a key or secret.

## Verification

1. A password-reset email for the synthetic account under **Synthetic check**
   arrives.
2. A message to the support address raises the "New support email" alert.
3. **API Keys** lists only the new key.

## Rollback

None: an exposed key must not return. A key or secret set wrong is fixed by
setting the right value and redeploying.
