# Runbook: move the product to `app.tendnote.com` (Stage 1)

Stage 1 of the
[private-beta migration and app-subdomain cutover](../phase-9b/private-beta-migration-and-app-subdomain-cutover.md):
the product moves from `tendnote.com` to `app.tendnote.com` while it is still
private, and `tendnote.com` redirects every path to the same path on the app.
Keep credentials in their existing provider stores. Record non-secret domain,
callback, and deployment settings in the private operations sheet under
**Domains** and **OAuth apps**, or in a dated `docs/verification/` record if that
sheet does not exist.

## Trigger

The owner schedules Stage 1. It runs before the restore drill and the
pre-launch tabletop, so both run on the final origin.

## Preconditions

1. **The product is origin-portable.** Every absolute URL is built from
   `BETTER_AUTH_URL`: Better Auth callbacks and email links, Household
   Invitation links, and the Discord install redirect and return. The PWA
   manifest and service worker name no origin, and session cookies are
   host-only (`packages/auth/src/server.ts`).
2. **A preview has passed on a subdomain origin.** Deploy the release to a
   preview whose own URL is set as its `BETTER_AUTH_URL`, then sign up with
   email, follow the verification link, request a password reset and complete
   it, and sign in again. In the browser's developer tools, confirm the session
   cookie has no `Domain` attribute.
3. **`app.tendnote.com` is attached** to the product's Vercel project, with DNS
   verified and a certificate issued. It serves the current deployment, but
   nothing links to it yet.
4. **Multi-valued OAuth registrations are added ahead**, so both origins work
   during the move and rollback needs nothing here:
   - Google OAuth client, authorized redirect URI:
     `https://app.tendnote.com/api/auth/callback/google`.
   - Discord application, OAuth2 redirects:
     `https://app.tendnote.com/api/auth/callback/discord` and
     `https://app.tendnote.com/api/integrations/discord/install/callback`.
5. **Origin-bearing variables are listed.** On the web project and, where Eve
   deploys as its own project, the Eve project, note the current value of `BETTER_AUTH_URL`, and of `TENDNOTE_WEB_URL` or
   `NEXT_PUBLIC_APP_URL` on Eve if either is set. These are the values rollback
   restores.
6. **Webhook endpoints are listed.** Providers POST webhooks to a fixed URL,
   and the apex redirect from step 4 cannot be relied on to carry them, so an
   endpoint left on `tendnote.com` stops receiving at the move. The
   [cutover decision](../phase-9b/private-beta-migration-and-app-subdomain-cutover.md)
   creates the live Stripe webhook directly on `app.tendnote.com` at Stage 2,
   and the Resend `email.received` webhook for support-email alerts
   ([ADR 0258](../adr/0258-operator-alerts-are-condition-episodes-sent-by-email-and-ntfy.md))
   belongs there too. In the Stripe dashboard (live and test mode) and the
   Resend dashboard, note any endpoint whose URL is on `tendnote.com`:
   `/api/stripe/webhook` or `/api/resend/webhook`. Usually there is none.

Nothing else carries the origin. Stripe Checkout and billing-portal return
URLs are built from `BETTER_AUTH_URL` per session. The marketing app already
links to `app.tendnote.com`. The Resend sending domain, the Web Push VAPID
subject (`mailto:`), the status page URL, and the Vercel cron and queue
triggers do not change.

## Steps

1. Set `BETTER_AUTH_URL` to `https://app.tendnote.com` for Production on every
   project from precondition 5. If Eve has `TENDNOTE_WEB_URL` or
   `NEXT_PUBLIC_APP_URL`, set it to the same value.
2. Redeploy Production on those projects. Everyone is signed out, because
   cookies are host-only on each origin.
3. Switch the single-valued registrations:
   - GitHub OAuth app, authorization callback URL:
     `https://app.tendnote.com/api/auth/callback/github`.
   - Discord application, Interactions Endpoint URL:
     `https://app.tendnote.com/eve/v1/discord`. Discord verifies the endpoint
     when you save it, so a failed save means the Eve deployment is not
     answering on the new origin yet.
   - Each webhook endpoint from precondition 6: edit its URL in place to the
     same path on `https://app.tendnote.com`, rather than creating a new
     endpoint, which would come with a new signing secret. Then confirm the
     signing secret the dashboard shows still matches `STRIPE_WEBHOOK_SECRET`
     or `RESEND_WEBHOOK_SECRET`; if it does not, update the variable and
     redeploy.
4. Redirect `tendnote.com` (and `www.tendnote.com`, if attached) to
   `app.tendnote.com` in the project's Domains settings with status **307**.
   Vercel blocks this while another domain redirects to `tendnote.com`.
   Record those aliases' current targets and status codes, then point them
   directly to `app.tendnote.com`, preserving the legacy aliases' status codes.
   Set the apex and www redirects to 307 after removing those incoming chains.
   Use a temporary redirect for the whole of Stage 1: browsers cache a
   permanent one, and a cached redirect would outlive a rollback.

## Record produced

None in the database: this is a deployment change, not an Operator Action on
an account. Before step 1, record the move date, the values from precondition 5,
the current deployment, and the actual domain and single-valued callback
settings. Use the operations sheet under **Domains** or a dated non-secret
verification record.

## Verification

Run immediately after the steps, before anything else depends on the new
origin:

1. `curl -sI 'https://tendnote.com/join/check?x=1'` returns 307 with
   `location: https://app.tendnote.com/join/check?x=1`. Vercel does not document
   whether a domain redirect keeps the path and query, so this check does; if
   either is dropped, roll back step 4 and stop.
2. GitHub sign-in completes on `app.tendnote.com`.
3. Google linking with Calendar, Gmail drafts, and Contacts completes.
4. Discord linking, a bot install into a test server, and one slash-command
   interaction all complete.
5. A new Household Invitation email links to `https://app.tendnote.com/join/...`,
   and the link opens the join page.
6. A new account's verification email and a password-reset email both link to
   `https://app.tendnote.com`, and both links work.
7. One cron pass (`/api/cron/background-jobs`) and one queue job complete in the
   Vercel logs.
8. Each endpoint moved in step 3 shows a successful delivery on its new URL.
   For Stripe, resend a recent event to the endpoint from the dashboard. For
   Resend, send a message to the support address and receive the "New support
   email" alert. Skip this check if precondition 6 listed none.
9. Remove the installed PWA, reinstall it from `app.tendnote.com`, turn
   reminders back on, and receive a push notification. Push subscriptions
   belong to an origin, so installs from `tendnote.com` no longer receive them.

## Rollback

Available until Stage 2 begins:

1. Restore the values recorded in precondition 5 and redeploy
   Production.
2. Restore `tendnote.com` to Production without a redirect, then restore www
   and the legacy aliases to their recorded targets and status codes.
3. Restore the GitHub callback, the Discord Interactions Endpoint URL, and any
   webhook endpoint moved in step 3 to their recorded previous values. Do not
   assume they all used the apex.

The dual-registered Google and Discord OAuth redirects need nothing. Once
Stage 2 begins, remove the `tendnote.com` OAuth registrations and fix forward on
the app origin.
