# Private-beta migration and app-subdomain cutover

Decision artifact for [Decide the private-beta migration and app-subdomain
cutover](https://github.com/nick-neely/tendnote/issues/590). It fixes how the
hosted private beta, its accounts, and its links move to the paid service on
the `app` subdomain: the order, the notice to beta users, what they see after,
the callback re-registration, and the rollback points. It does not build
anything, change production, or send any notice.

All decisions below were confirmed by the owner in the grilling session of
2026-09-26.

## Facts this decision rests on

- The product serves admitted Home at `/` on `tendnote.com` today. One setting,
  `BETTER_AUTH_URL`, is the sole trusted origin and builds every absolute URL
  (`packages/auth/src/server.ts`), so a deployment serves the product on
  exactly one origin at a time.
- Session cookies are host-only with Better Auth's default prefix; no cookie
  domain or cross-subdomain setting exists. Moving origins signs everyone out.
- Links outside systems hold into the product: GitHub sign-in, Google linking
  (Calendar, Gmail drafts, Contacts), and Discord linking callbacks under
  `/api/auth/callback/*`; the Discord bot install callback; the Discord
  interactions endpoint at `/eve/v1/discord`; Household Invitation `/join/<secret>`
  emails; the PWA manifest and service worker; and origin-bound push
  subscriptions. No calendar feed, share URL, API token, or Stripe endpoint
  exists yet.
- Beta grants persist: the `private-beta-access` flag writes a `beta_flag`
  grant to the Access Profile, so turning the flag off does not end a grant.
- Only the author holds a hosted account
  ([Subscription ownership and paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md)).
- The "marker-based cutover drain" from the
  [Recovery Journal research](../research/phase-9b-recovery-journal.md) is the
  restore-to-production cutover, not a domain move. It plays no part here.

## Beta population, notice, and concession

The beta closes now: no new beta grants before launch, so the author is the
only beta account. The author's account moves to `manual_grant`, the operator
exemption, before the Beta Sunset.

The policy is recorded anyway, so it holds if the population changes: fourteen
days' notice by email before the Beta Sunset, and no concession within the
one-plan offer, consistent with the no-grandfathering rule already decided.

## The Beta Sunset

The **Beta Sunset** is a condition, not a date: beta grants end in the same
release that turns on Checkout, so no moment exists with neither a beta grant
nor a way to pay. That release carries a data migration that moves every
remaining `beta_flag` grant to pending with a recorded beta-ended reason.
Private Beta Access itself stays, with nobody targeted, as the operator's
admission-experiment mechanism.

The day after, an ex-beta account lands in the pending area: one line saying
the beta ended and its data is intact, the launch Terms re-acceptance, and
Subscribe. It is Unpaid with no retention clock, as
[Prototype self-service signup through first value](self-service-signup-through-first-value.md)
already decided.

## Two stages

```text
Stage 1 (private)                        Stage 2 (launch)
product -> app.tendnote.com              1. author on manual_grant
tendnote.com redirects everything        2. live Stripe webhook + reconciliation
  to the app                                verified on app.tendnote.com
callbacks re-registered, verified        3. one release: Checkout on + Beta Sunset
restore drill + tabletop run here        4. marketing takes tendnote.com last
```

### Stage 1: the product moves while private

The product moves to `app.tendnote.com` as its own release, with
`tendnote.com` redirecting every path to the same path on the app. It happens
once the product runs correctly on a subdomain, and before the restore drill
and the timed pre-launch tabletop, so both launch gates run on the final
origin. No fixed date.

- **Cookies** stay host-only on `app.tendnote.com`. Marketing never reads the
  session; its Sign in is a plain link. Marketing therefore cannot show
  "Open app" to a signed-in visitor, an accepted cost. Cross-subdomain
  cookies would reach every future subdomain, including `mail.`, for no
  launch benefit.
- **Callbacks.** Google and Discord OAuth accept several redirect URIs, so the
  app-subdomain URIs are added ahead of the move. GitHub's OAuth app holds one
  callback and Discord one interactions endpoint, so both switch during the
  move. The Stripe webhook is created later, directly on `app.tendnote.com`,
  and never moves.
- **Verification** runs immediately after the switch, before anything else
  depends on the new origin: GitHub sign-in; Google linking with Calendar,
  Gmail drafts, and Contacts; Discord linking, bot install, and an
  interaction; a Household Invitation link; a cron pass and a queue job; and a
  push notification after reinstalling the PWA.
- **Rollback** restores `BETTER_AUTH_URL` to `tendnote.com` and redeploys,
  removes the apex redirect, and points the GitHub callback and Discord
  interactions endpoint back. The dual-registered Google and Discord URIs need
  nothing. The window stays open until Stage 2 begins; the old registrations
  are then removed and fixes go forward on the app origin. No customer and no
  money exist yet, so this rollback touches neither.

### Stage 2: launch

In order: the author's account moves to `manual_grant` (any time before); the
live Stripe webhook and reconciliation are registered and verified on
`app.tendnote.com`; one release turns on Checkout and runs the Beta Sunset;
the marketing site takes `tendnote.com` last, so public discovery opens only
once subscribing works.

The marketing site is a separate Vercel project in the monorepo, reusing the
shared UI packages. It has no authentication and its own release pace, and
detaching it never touches the product. Host-based routing inside one app was
rejected because it couples marketing and product releases.

- **Old links.** After marketing takes the apex, permanent (308) redirects to
  the same path on the app remain for `/join/*`, `/sign-in`, and `/sign-up`
  only: the entry points held in emails and bookmarks, none of which collide
  with a marketing page. Every other path belongs to marketing; unknown paths
  return a 404 that links to the app. No blanket redirect, as the
  [marketing decision](marketing-site-and-demo-experience.md) required.
- **Rollback** until the first non-operator account is admitted: detach the
  marketing project from `tendnote.com`, restore the redirect-everything rule,
  and turn Checkout off by its flag. Ex-beta accounts stay pending at no cost
  because none exist, and `manual_grant` keeps the author in. After the first
  non-operator admission, only fix forward; refunds and suspensions already
  have their procedures.

## Handed to the specification

- Stage 1 verification and the Stage 2 order become Launch Gates alongside the
  restore drill and tabletop, which run after Stage 1.
- The fourteen-day notice applies only if anyone besides the author is ever
  granted beta access; with the beta closed, no notice is drafted.
