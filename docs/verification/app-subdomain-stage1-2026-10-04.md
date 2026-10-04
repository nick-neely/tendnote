# Stage 1 app subdomain migration, 2026-10-04

Issue: [#605](https://github.com/nick-neely/tendnote/issues/605).
Procedure: [Stage 1 runbook](../operations/app-subdomain-move.md).

Status: production cutover and apex/www redirects complete. Core GitHub sign-in,
Google Calendar/Contacts, Discord bot install/interaction, invitation links, cron
and extraction queue checks passed. Owner deferred Gmail draft creation, reset
submission, and phone PWA/push verification. On 2026-10-04, the owner accepted
the migration with the verification limits below and authorized closing #605
when the PR containing this record and the runbook updates merges. Deferred
and unverified checks remain recorded as such, rather than marked passed.
This record contains only non-secret settings. Credentials remain in their
existing provider stores. The private operations sheet referenced by the
runbook has not been created; this file records rollback information instead.

## Before the move

- Product Vercel project: `nick-neely/tendnote-web`.
- `tendnote.com`: connected to Production, with no app-subdomain redirect.
- `www.tendnote.com`: 308 redirect to `tendnote.com`.
- Incoming aliases: `www.tendnote.stacklet.app` (308),
  `tendnote.stacklet.app` (301), and `tendnote-web.vercel.app` (308),
  all previously redirected to `tendnote.com`.
- GitHub OAuth callback: `https://tendnote.com/api/auth/callback/github`.
- Cloudflare manages DNS. There was no `app.tendnote.com` DNS record.
- Apex `/join/check?x=1` returned HTTP 200 on 2026-10-04.
- Production `BETTER_AUTH_URL`: `https://tendnote.com`.
- `TENDNOTE_WEB_URL` and `NEXT_PUBLIC_APP_URL`: absent from the product project.
- Prior Production deployment: `https://tendnote-14elx9ekw-nick-neely.vercel.app`,
  Ready, `main` commit `6ccb859`.
- Discord interactions endpoint:
  `https://tendnote.stacklet.app/eve/v1/discord`.
- Discord OAuth redirects before preparation:
  `https://tendnote.stacklet.app/api/auth/callback/discord` and
  `https://tendnote.stacklet.app/api/integrations/discord/install/callback`.

## Preparation observed

- Cloudflare `app.tendnote.com` CNAME saved to
  `5588ad81a0bf0ecc.vercel-dns-016.com`, DNS only, TTL Auto.
- Independently confirmed with `dig +short app.tendnote.com
  @roxy.ns.cloudflare.com`. Local recursive resolution was still negative
  immediately after the change.
- Vercel shows `app.tendnote.com` as Valid Configuration, Production.
- TLS certificate validation and HTTP 200 for `/sign-in` independently passed
  using `curl --resolve app.tendnote.com:443:216.150.1.1` on 2026-10-04.
  Ordinary browser resolution was still cached negative at this point.
- Discord saved both app-host OAuth redirect URIs and retained both existing
  stacklet redirect URIs. Its UI confirmed the edits were recorded.
- Google saved `https://app.tendnote.com/api/auth/callback/google`, retaining
  existing localhost and apex callbacks.

## Authorized verification adjustment

The Preview environment lacks database/auth configuration. The owner explicitly
waived the separate preview auth test on 2026-10-04 because they are the only
Production user and the service is in beta. They authorized testing the new
Production hostname with rollback ready before enabling the apex redirect.

## Rollback until Stage 2

1. Restore each origin variable to its recorded previous value and redeploy
   the affected Production projects.
2. Restore `tendnote.com` to Production without a redirect; restore
   `www.tendnote.com` to its previous 308 redirect to `tendnote.com`.
   Restore the three incoming aliases to `tendnote.com` with their recorded
   redirect types after restoring apex Production.
3. Restore the GitHub OAuth callback to its recorded apex URL. Restore
   Discord's interactions endpoint to its recorded stacklet URL; the live
   configuration differed from the runbook's assumed apex baseline.
4. Retain both origins in Google and Discord OAuth registrations.

## Production changes

- Production `BETTER_AUTH_URL` saved as `https://app.tendnote.com`.
- Same-source redeploy started for `main` commit `6ccb859`:
  `https://tendnote-4petl8p4k-nick-neely.vercel.app`.
  Deployment ID: `9u1WBrJV8tcTA7Jq7cUHRvW6RrSt`. Ready after 2m17s.
  New release `/sign-in` passed TLS and HTTP 200 using current public DNS IP.
- GitHub callback saved as
  `https://app.tendnote.com/api/auth/callback/github`; GitHub confirmed success.
- Discord interactions endpoint saved as
  `https://app.tendnote.com/eve/v1/discord`; Discord accepted the verification
  handshake and confirmed the edits were recorded.
- Apex and www now use 307 redirects directly to `app.tendnote.com`.
- Vercel rejected an apex redirect while other domains redirected to apex.
  Retargeted the three incoming aliases directly to app, preserving their
  previous 301/308 types; then enabled the apex redirect.
- Local router and Tailscale DNS returned cached NXDOMAIN with remaining
  negative TTL approximately 660 seconds at 13:57 CDT. Public Google and
  Cloudflare resolvers returned the new CNAME and Vercel IPs. Browser auth
  subsequently passed using the temporary Secure DNS setting below.
- Temporarily selected Cloudflare Secure DNS in Aside to bypass the upstream
  negative cache. `/sign-in` now loads in the real browser with HTTPS.
  Original setting: Secure DNS on, OS default (when available). Restoration
  completed after testing: Secure DNS remains on with OS default selected.
  Local DNS resolution now returns the app CNAME and Vercel IPs normally.

## Verification

Observed on 2026-10-04:

- Authoritative/public DNS, Vercel domain attachment, TLS and `/sign-in` pass.
- GitHub owner sign-in returned to the actual Today page on app origin.
- Apex and www `/join/check?x=1` independently returned HTTP 307 with exact
  `Location: https://app.tendnote.com/join/check?x=1` at 14:17 CDT.
- Owned plus-address test signup, verification email delivery, verification link
  and email/password sign-in reached the expected private-beta Pending page.
- Password reset email delivered and its app-origin form opened. Submission
  requires the owner to enter the replacement password under computer-use policy.
- Existing Google Calendar, Gmail, Contacts and Discord connections appear on
  the new origin. Calendar read failed; Contacts preview reported
  `Failed to get a valid access token`. Refreshed the existing Calendar/Contacts
  OAuth scopes through the new app callback. Calendar then displayed events,
  and Contacts fetched 14 candidates in its private preview. No contacts imported.
- Discord accepted the new interactions endpoint verification handshake.
- Bot installation into the owner-confirmed Layer Zero test server returned to
  `app.tendnote.com/account/discord` with an installed success message.
- One labeled `/capture` test in the private localhost channel returned the
  ephemeral response `Captured as Tendnote logged context for review`.
- Vercel cron at 14:20:41 CDT completed HTTP 200 on the new Production
  deployment. Its owner-data-export job failed with `processing_failure`;
  identical job/failure appears on prior deployments at 13:50, 13:40 and
  earlier, confirming this is inherited rather than introduced by the move.
- Household test invitation delivered to the owned plus-address with an
  app-origin join URL. The exact email link opened the expected different-address
  join page in the owner session. No membership accepted; cancelled the test
  invitation afterward, returning the household to one reserved place.
- Test capture triggered `/api/queue/extraction` at 14:24:18 CDT, HTTP 200.
  Invocation ran the AI gateway call and acknowledged its queue message with
  DELETE HTTP 204, completing in 3.0 seconds on the new deployment.

Verification limits:

- Runtime host-only session-cookie inspection remains unverified; successful
  GitHub and email/password sessions were observed on the app origin.
- Discord identity remained connected as Maddog. Its separate identity-relink
  callback was saved but not exercised. Automatic approval review rejected
  disconnecting the established integration solely to retest this flow; retained
  it and verified the install callback and a real interaction instead.
- Owner explicitly deferred Gmail draft creation, password-reset submission,
  and phone PWA reinstall/push receipt. The Gmail test prompt created only a
  labeled assistant conversation; no Gmail draft or additional person/source
  records were created. Additional test records were rejected by approval review,
  and the owner chose to defer rather than expand scope.
- Separate preview auth test waived by owner as documented above.
- Stripe/Resend webhook inventory and delivery checks in the newer runbook
  on main were not performed during this migration. No webhook changes or
  delivery claims are included in this record.
- Original browser Secure DNS setting restored. Final ordinary DNS/TLS
  `/sign-in` HTTP 200 and apex/www exact 307 checks passed after restoration.

Test artifacts retained: owned plus-address Pending beta account, labeled
Discord capture for review, and labeled Gmail-test assistant conversation.
Test invitation was cancelled; no new household member or contact imported.

The owner approved test verification/reset/invitation emails to their own
account, a clearly labeled Gmail test draft, and one interaction in their own
Discord test server. No checklist item is marked passed without observation.
