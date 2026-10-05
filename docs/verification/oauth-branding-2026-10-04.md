# OAuth branding and production prerequisites

Recorded 2026-10-04. Provider settings were inspected and edited through Aside
Browser. This is a non-secret configuration record, not a public-launch sign-off.

## Saved provider settings

| Provider | Branding and changes | Routing |
| --- | --- | --- |
| GitHub OAuth application `3696311` | Changed lowercase `tendnote` to `Tendnote`; added the product description below. Existing icon visually matches the repository's Tendnote icon. Disabled callback wildcard matching. | Homepage `https://tendnote.com`; exact callback `https://app.tendnote.com/api/auth/callback/github`. |
| Google project `tendnote`, client `Tendnote Web` | Existing name `Tendnote` and icon are correct. Saved privacy and terms URLs below. Developer contact remains `nick@tendnote.com`. | Homepage `https://tendnote.com/`; authorized domain `tendnote.com`; app Google callback registered alongside retained localhost/apex callbacks. |
| Discord application `1529841899781881945` | Existing application and bot names `Tendnote`, and both icons, are correct. Added the description below and saved privacy and terms URLs. | App identity and bot-install callbacks registered; interactions endpoint `https://app.tendnote.com/eve/v1/discord`. Retained earlier stacklet callbacks for the migration rollback window. |

GitHub description:

> A private relationship memory and follow-up assistant. Be the friend who remembers.

Discord description:

> Tendnote is a private relationship memory and follow-up assistant. Capture notes about the people you care about from Discord, then review them in Tendnote. Be the friend who remembers.

Canonical URLs saved in Google and Discord:

- Privacy policy: `https://tendnote.com/privacy`
- Terms: `https://tendnote.com/terms`

Google support email remains `neelynickolas@gmail.com`: it is the only available
selection, and no managed Google Groups are listed. A branded support email would
need an eligible Google account or managed group before it can be selected.

## Domain ownership

Created the Search Console domain property `tendnote.com` under the Google account
associated with the OAuth project. Added Google's verification TXT record at the
Cloudflare zone apex with automatic TTL. Search Console confirmed **Ownership
verified**, and the Tendnote property opened successfully. Keep that TXT record
to retain verification. Existing routing and mail records were preserved.

## Remaining production prerequisites

- Google is **External / Testing**, with one test user. Public access was not
  enabled and brand/data-access verification was not submitted.
- Both canonical legal URLs currently redirect to the app and return **404**.
  The saved URLs prepare the provider configuration for the marketing launch;
  they do not establish working public legal pages. Stage 2 is tracked by
  [#660](https://github.com/nick-neely/tendnote/issues/660), including final legal
  publication in [#658](https://github.com/nick-neely/tendnote/issues/658).
- Before Google verification, make the public homepage, privacy policy, and
  terms reachable at these URLs. Confirm the policy accurately describes Google
  data use and satisfies Google's applicable Limited Use requirements.
- Google declares the application's existing scopes: non-sensitive `openid`,
  `userinfo.email`, and `userinfo.profile`; sensitive
  `calendar.events.readonly` and `contacts.readonly`; restricted `gmail.compose`.
  The integration scopes match the repository's provider catalog and Gmail draft
  module. No permissions were added or removed.
- A public release needs the applicable brand and scope verification. Google's
  [restricted-scope requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
  also require a security assessment for restricted data accessed from or
  through a third-party server, unless an exception applies. The current personal
  beta is distinct from a public production release.
- Discord's portal requires team ownership and identity/application verification
  before scaling past 100 servers. Its current verification checklist has only
  the team-ownership criterion missing. No ownership transfer or verification
  attestations were performed. The portal accepting the legal-link fields does
  not mean their destinations are live.

Provider save confirmations were observed. Logos were checked visually in the
real interfaces. After disabling GitHub wildcard matching, signed out and used
Continue with GitHub; the flow returned to the authenticated owner account on
`app.tendnote.com/account`, with the existing integrations connected. The earlier migration
flow results and accepted deferred checks remain in
[the Stage 1 record](app-subdomain-stage1-2026-10-04.md).
