# Google Calendar OAuth Setup (Phase 2C)

> **Human-in-the-loop slice.** This guide configures Google Cloud and Tendnote
> environment variables so Phase 2C can authorize live Google Calendar access.
> The Google Cloud Console steps cannot be completed by an agent or by code —
> an operator with access to the Google Cloud project must run them. Code slices
> (#107 onward) assume the credentials and callback URLs below are already in
> place.

Tendnote authorizes Calendar through **Better Auth's Google social provider and
`linkSocial` flow** (ADR-0071). Better Auth owns OAuth token custody, refresh,
and encryption; Tendnote Provider Connections only mirror non-secret status,
display identity, and authorized-scope metadata. Do **not** build a separate
OAuth subsystem or store provider tokens in a Tendnote table.

Phase 2C requests **Calendar event-read access only**. It does **not** request
Gmail or Contacts scopes (ADR-0072, PRD Out of Scope).

---

## 1. Google Cloud Console: consent screen

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select
   (or create) the project that will own Tendnote's OAuth client.
2. Go to **APIs & Services → Enabled APIs & services** and enable the
   **Google Calendar API**.
3. Go to **APIs & Services → OAuth consent screen**.
   - **User type:** External (Internal is only available for Google Workspace
     orgs; use it if every tester is in your Workspace org).
   - **App name:** Tendnote. Add a support email and developer contact email.
   - **App domain / authorized domains:** add your production domain (e.g.
     `tendnote.stacklet.app/`) once known. Localhost does not need an authorized domain.
   - **Publishing status:** keep the app in **Testing** during private beta and
     add each beta tester's Google account under **Test users**. A Testing app
     issues refresh tokens to test users without full verification. Move to
     **In production** (which may require Google verification for sensitive
     scopes) only when opening Calendar beyond the beta testers.

## 2. Scopes

Add exactly the scopes Tendnote uses — no more.

| Purpose | Scope | Notes |
| --- | --- | --- |
| Read event details for the primary calendar | `https://www.googleapis.com/auth/calendar.events.readonly` | Narrowest scope that returns event title, time, attendees, status, and selected location/description fields (ADR-0072). Sufficient for the `primary` calendar (ADR-0076). |
| Sign-in identity (connected Google account email) | `openid`, `email`, `profile` | Better Auth requests these by default; they back the connection's display identity. |

**Do not add** `https://www.googleapis.com/auth/calendar` (read/write),
`calendar.readonly` (broader than event-read), any `gmail.*` scope, or any
`contacts`/`directory` scope. Gmail and Contacts are explicitly later phases.

> If a future slice needs the user's calendar **list** (to pick secondary
> calendars), revisit the scope choice then. Phase 2C reads only `primary`, so
> `calendar.events.readonly` is enough and `calendarId` is still carried through
> the seams (ADR-0076).

## 3. OAuth client credentials

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. **Application type:** Web application.
3. **Authorized redirect URIs** — add one per environment. Better Auth's Google
   callback path is `/api/auth/callback/google` under `BETTER_AUTH_URL`:

   | Environment | Redirect URI |
   | --- | --- |
   | Local | `http://localhost:3000/api/auth/callback/google` |
   | Production | `https://<your-production-domain>/api/auth/callback/google` |
   | Preview (optional) | `https://<your-preview-domain>/api/auth/callback/google` |

   Vercel preview deployments use generated domains. Add a stable preview alias
   (or skip preview Calendar testing) rather than chasing per-deploy URLs.
4. Save and copy the **Client ID** and **Client secret**. The secret is shown
   once — store it in your secret manager, never in the repo.

## 4. Environment variables

Calendar reuses the same web-app env file as the other Better Auth providers
(`apps/web/.env.local` locally; project env vars in hosting). It follows the
existing `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` pattern — set **both** to
enable the Google connect affordance; leave either unset and it stays disabled.

```bash
# apps/web/.env.local (local) — set both to enable Google Calendar connect.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Required in production/preview so the OAuth redirect matches the registered
# callback URL exactly. Locally it defaults to http://localhost:3000.
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=   # required in production; openssl rand -base64 32
```

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are **server-only**. Never prefix
  them with `NEXT_PUBLIC_`.
- The redirect URI registered in Google must match `BETTER_AUTH_URL` +
  `/api/auth/callback/google` byte-for-byte (scheme, host, port, path).
- Never commit `.env*` files or paste credentials into issues, logs, or PRs.

## 5. Local smoke checklist

Run after the code slices land, with `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
set in `apps/web/.env.local` and `pnpm dev` running on `:3000`.

- [ ] **Connect:** From the account/settings provider area, start the Google
      Calendar connect flow. Google's consent screen lists **only** Calendar
      event-read (plus sign-in identity) — no Gmail or Contacts.
- [ ] **Status:** After returning to Tendnote, the Calendar Provider Connection
      shows `connected` with the connected Google account's display identity and
      the authorized event-read scope. No tokens are visible anywhere in the UI.
- [ ] **Read:** Ask Eve about an upcoming or recent meeting (or open the preview
      surface). Minimized event summaries appear for a bounded window; no raw
      Google payload is shown or stored.
- [ ] **Disconnect:** Disconnect Calendar. The connection moves to `revoked`,
      cached Calendar summaries are cleared, and further Calendar reads are
      blocked until reconnect. If provider-side revocation could not complete,
      the UI explains the remaining Google Account permission cleanup.
- [ ] **Failure cleanup:** Revoke Tendnote's access from your
      [Google Account permissions](https://myaccount.google.com/permissions),
      then trigger a Calendar read. Eve, previews, and briefs degrade
      gracefully; auth failure (not transient noise) is what surfaces as an
      error state.
- [ ] **Secret safety:** Tail the dev server logs during the flow. No OAuth
      tokens and no raw provider payloads appear in logs.

## 6. Hosted (preview/production) smoke checklist

- [ ] Project env vars set the Google client id/secret and a `BETTER_AUTH_URL`
      matching the deployed origin; the deployed origin's
      `/api/auth/callback/google` is a registered redirect URI in Google.
- [ ] **Connect → status → read → disconnect** all work end-to-end on the hosted
      deployment for an admitted beta tester listed as a Google **Test user**.
- [ ] Disconnect on the hosted deployment clears cache, audits the Provider
      Connection transition, and blocks further reads until reconnect.
- [ ] **Failure cleanup:** Revoke Tendnote's access from
      [Google Account permissions](https://myaccount.google.com/permissions),
      then trigger a hosted Calendar read. Eve, previews, and briefs degrade
      gracefully and the connection surfaces an auth-failure (not transient)
      state rather than silently appearing connected.
- [ ] Hosted logs and audit entries contain no OAuth tokens or raw provider
      payloads.

## 7. Verification status notes

- Normal `pnpm verify` must stay deterministic and must **not** depend on live
  Google credentials, Better Auth OAuth redirects, Vercel, or network provider
  availability. Live Google checks are explicit, opt-in smoke tests only.
- Treat this checklist as the human acceptance gate for the operator-facing
  parts of Phase 2C: consent configured, callback URLs correct, env vars
  present, local flow works, hosted flow works, and disconnect cleanup works.
