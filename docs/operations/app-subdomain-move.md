# Runbook: move the product to `app.tendnote.com` (Stage 1)

Stage 1 of the
[private-beta migration and app-subdomain cutover](../phase-9b/private-beta-migration-and-app-subdomain-cutover.md):
the product moves from `tendnote.com` to `app.tendnote.com` while it is still
private, and `tendnote.com` redirects every path to the same path on the app.
Provider ids, dashboard locations, and credentials are in the private
operations sheet under **Domains** and **OAuth apps**; this runbook never
copies them.

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

Nothing else carries the origin. The Resend sending domain, the Web Push VAPID
subject (`mailto:`), and the Vercel cron and queue triggers do not change.

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
4. Redirect `tendnote.com` (and `www.tendnote.com`, if attached) to
   `app.tendnote.com` in the project's Domains settings with status **307**.
   Use a temporary redirect for the whole of Stage 1: browsers cache a
   permanent one, and a cached redirect would outlive a rollback.

## Record produced

None in the database: this is a deployment change, not an Operator Action on
an account. Before step 1, write the move date and the values from
precondition 5 in the operations sheet under **Domains**.

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
8. Remove the installed PWA, reinstall it from `app.tendnote.com`, turn
   reminders back on, and receive a push notification. Push subscriptions
   belong to an origin, so installs from `tendnote.com` no longer receive them.

## Rollback

Available until Stage 2 begins:

1. Restore the values recorded in precondition 5 and redeploy
   Production.
2. Remove the domain redirect from `tendnote.com`.
3. Point the GitHub callback and the Discord Interactions Endpoint URL back at
   `tendnote.com`.

The dual-registered Google and Discord OAuth redirects need nothing. Once
Stage 2 begins, remove the `tendnote.com` OAuth registrations and fix forward on
the app origin.
