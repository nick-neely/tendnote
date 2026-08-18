# Google OAuth Setup

> **Human-in-the-loop setup.** This guide configures Google Cloud and Tendnote
> environment variables so Tendnote can authorize Google provider capabilities.
> The Google Cloud Console steps cannot be completed by an agent or by code; an
> operator with access to the Google Cloud project must run them.

Tendnote authorizes Google capabilities through **Better Auth's Google social
provider and `linkSocial` flow** (ADR-0071, ADR-0090, ADR-0107). Better Auth owns OAuth
token custody, refresh, and encryption. Tendnote Provider Connections mirror only
non-secret product status, display identity, and authorized-scope metadata for
each capability, such as `google/calendar`, `google/gmail`, and `google/contacts`.

Do **not** build a separate OAuth subsystem or store provider tokens in a
Tendnote table.

---

## 1. What to enable in Google Cloud

Open the [Google Cloud Console](https://console.cloud.google.com/) and select
the project that owns Tendnote's OAuth client.

Enable only the APIs that match the Tendnote capabilities you are testing:

| Capability | Google API | Needed for |
| --- | --- | --- |
| Google Calendar | Google Calendar API | Read-only upcoming/recent event summaries and Calendar-derived follow-up suggestions. |
| Gmail | Gmail API | Creating and updating user-approved Gmail drafts. |
| Google Contacts | People API | Explicit preview of personal contacts before confirmed Tendnote profile/contact enrichment. |

Enable the People API only when testing Phase 2E Contacts import preview. Do not
enable Directory API, Admin SDK, or organization-wide contact APIs.

## 2. OAuth consent screen

1. Go to **APIs & Services -> OAuth consent screen**.
2. Set **User type** to External, unless every tester is inside your Google
   Workspace org and Internal is available.
3. Set **App name** to Tendnote. Add a support email and developer contact email.
4. Add your production domain under **App domain / authorized domains** once
   known. Localhost does not need an authorized domain.
5. During private beta, keep the app in **Testing** and add each beta tester's
   Google account under **Test users**. Move to **In production** only when you
   are ready for broader access and any required Google verification.

## 3. Scopes

Add exactly the scopes Tendnote uses, no more.

| Purpose | Scope | Notes |
| --- | --- | --- |
| Sign-in identity for the connected Google account | `openid`, `email`, `profile` | Better Auth requests identity scopes for the linked Google account and display identity. |
| Read event details for the primary calendar | `https://www.googleapis.com/auth/calendar.events.readonly` | Used by Phase 2C. Narrower than full calendar read/write and enough for event title, time, attendees, status, selected location, and description excerpts. |
| Create and update Gmail drafts | `https://www.googleapis.com/auth/gmail.compose` | Used by Phase 2D. Allows draft create/update; Tendnote still has no send path and does not read Gmail history. |
| Preview personal contacts | `https://www.googleapis.com/auth/contacts.readonly` | Used by Phase 2E. Read-only personal contacts for explicit preview; no Directory, Admin, inferred contacts, or writes. |

Do **not** add these broader scopes for the current product:

- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.send`
- `https://mail.google.com/`
- `https://www.googleapis.com/auth/contacts`
- `https://www.googleapis.com/auth/contacts.other.readonly`
- `https://www.googleapis.com/auth/directory.readonly`
- Directory API, Admin SDK, organization, or inferred-contact scopes

Calendar, Gmail, and Contacts are separate Tendnote Provider Connection
capabilities. A user may connect one without the others, even though all use the
same Google OAuth client and Better Auth account-link custody. Contacts must use
the same linked Google account identity as the owner's other connected Google
capabilities; Tendnote blocks mismatches until explicit multi-account semantics
exist.

## 4. OAuth client credentials

1. Go to **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**.
2. Set **Application type** to Web application.
3. Add one authorized redirect URI per environment. Better Auth's Google callback
   path is `/api/auth/callback/google` under `BETTER_AUTH_URL`:

   | Environment | Redirect URI |
   | --- | --- |
   | Local | `http://localhost:3000/api/auth/callback/google` |
   | Production | `https://<your-production-domain>/api/auth/callback/google` |
   | Preview, optional | `https://<your-preview-domain>/api/auth/callback/google` |

   Vercel preview deployments use generated domains. Add a stable preview alias
   or skip live Google smoke tests on previews rather than chasing per-deploy URLs.
4. Save and copy the **Client ID** and **Client secret**. The secret is shown
   once. Store it in your secret manager, never in the repo.

## 5. Environment variables

Google integrations reuse the same web-app env file as the other Better Auth
providers: `apps/web/.env.local` locally, and project env vars in hosting.

Set both Google values to enable Google capability connect buttons. Leave either
unset and Google connect flows stay disabled. Hosted Eve and local scheduled or
non-request Calendar reads also need the same pair in `apps/agent/.env.local` so
its lifecycle-only Better Auth instance can refresh encrypted account tokens;
Eve exposes no Google OAuth UI, callback, sign-in, or account-linking route
(ADR 0224).

```bash
# apps/web/.env.local (local)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Required in production/preview so the OAuth redirect matches the registered
# callback URL exactly. Locally it defaults to http://localhost:3000.
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=   # required in production; openssl rand -base64 32

# apps/agent/.env.local (same values for non-request Calendar lifecycle reads)
# Hosted Eve uses the production web origin instead of localhost below.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BETTER_AUTH_URL=http://localhost:3000  # hosted Eve: https://<production-domain>
BETTER_AUTH_SECRET=   # exactly the same value as the web app
DATABASE_URL=         # exactly the same database as the web app
REDIS_URL=            # exactly the same Redis as the web app
```

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are **server-only**. Never prefix
  them with `NEXT_PUBLIC_`.
- The redirect URI registered in Google must match `BETTER_AUTH_URL` +
  `/api/auth/callback/google` byte-for-byte.
- Never commit `.env*` files or paste credentials into issues, logs, or PRs.

## 6. Local smoke checklist

Run after the relevant code slices land, with `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` set in both `apps/web/.env.local` and
`apps/agent/.env.local`, and `pnpm dev` running on `:3000`.

### Calendar

- [ ] **Connect:** From the account provider area, start the Google Calendar
      connect flow. Google's consent screen lists Calendar event-read plus
      identity scopes, not broad Calendar, Gmail, Contacts, or send scopes.
- [ ] **Status:** After returning to Tendnote, the Calendar Provider Connection
      shows `connected` with the connected Google account display identity and
      the authorized event-read scope. No tokens are visible in the UI.
- [ ] **Read:** Ask Eve about an upcoming or recent meeting, or open the account
      preview. Minimized event summaries appear for a bounded window; no raw
      Google payload is shown or stored.
- [ ] **Disconnect:** Disconnect Calendar. The connection moves to `revoked`,
      cached Calendar summaries are cleared, and Calendar reads are blocked until
      reconnect. If provider-side revocation could not complete, the UI explains
      Google Account permission cleanup.
- [ ] **Failure cleanup:** Revoke Tendnote from
      [Google Account permissions](https://myaccount.google.com/permissions),
      then trigger a Calendar read. Eve and previews degrade gracefully; auth
      failure, not transient noise, is what surfaces as an error state.

### Gmail

- [ ] **Connect:** From the account provider area, start the Gmail connect flow.
      Google's consent screen lists `gmail.compose` plus identity scopes, not
      Gmail read, modify, send, history, mailbox, Contacts, or Calendar write
      scopes.
- [ ] **Status:** After returning to Tendnote, the Gmail Provider Connection
      shows `connected` with the connected Google account display identity and
      the authorized compose scope. Calendar connection state remains independent.
- [ ] **Create draft:** From an approved Tendnote message draft, confirm a `to`
      recipient and subject, then create the Gmail draft. Gmail contains a draft;
      no email is sent.
- [ ] **Update draft:** Revise the linked Tendnote draft and explicitly update
      Gmail. The existing Gmail draft is updated rather than a duplicate being
      created.
- [ ] **Failure cleanup:** Revoke Tendnote from Google Account permissions, then
      attempt a Gmail draft write. Tendnote reports a visible failure/retry state
      and does not background retry.

### Contacts

- [ ] **Connect:** From the account provider area, start the Google Contacts
      connect flow. Google's consent screen lists `contacts.readonly` plus
      identity scopes, not Directory, Admin, inferred-contact, Contacts write,
      Gmail, or Calendar write scopes.
- [ ] **Same identity:** If Calendar or Gmail is already connected, the Contacts
      row connects only for the same linked Google account identity. A different
      Google account is blocked with visible recovery copy.
- [ ] **Preview entry:** After returning to Tendnote, the Contacts Provider
      Connection shows `connected` and the account row offers **Preview latest
      contacts**. Opening preview is explicit; no contacts are saved merely by
      connecting.
- [ ] **Live preview:** Open `/account/contacts/import`. The preview fetches
      only personal People API contacts using `names,emailAddresses,phoneNumbers,birthdays`
      with `READ_SOURCE_TYPE_CONTACT`; no Directory, Admin, inferred contacts,
      or raw People payload appears in the UI or logs.
- [ ] **Confirm safe:** Confirm a safe recommendation. Tendnote updates only
      confirmed Tendnote-owned people/contact fields, stores a minimized provider
      contact reference, and records audit/provenance. No Gmail draft, send,
      Calendar write, or outbound behavior occurs.
- [ ] **Resolve review:** Resolve one conflicting/advisory candidate by choosing
      the target person and winning values. Conflicting Tendnote fields are not
      overwritten unless explicitly chosen, and skipped candidates create no
      durable relationship writes.
- [ ] **Failure cleanup:** Revoke Tendnote from Google Account permissions, then
      open Contacts import preview. Tendnote shows a visible preview failure and
      confirmation actions do not apply partial durable changes.
- [ ] **Disconnect:** Disconnect Contacts. Future Contacts preview reads are
      blocked, while confirmed Tendnote-owned people, emails, phones, and
      birthdays remain editable in Tendnote.

### Secret safety

- [ ] Tail dev server logs during all flows. No OAuth tokens, raw Calendar
      payloads, raw Gmail API payloads, raw People API payloads, message history,
      labels, threads, mailbox data, or directory data appear in logs.

## 7. Hosted smoke checklist

- [ ] Project env vars set the Google client id/secret and a `BETTER_AUTH_URL`
      matching the deployed origin.
- [ ] The deployed origin's `/api/auth/callback/google` is registered as an
      authorized redirect URI in Google Cloud.
- [ ] The beta tester's Google account is listed under Google OAuth **Test users**
      while the consent screen is in Testing mode.
- [ ] Calendar connect -> status -> read -> disconnect works end-to-end.
- [ ] Gmail connect -> status -> create draft -> update draft works end-to-end.
- [ ] Contacts connect -> status -> preview entry -> live preview -> safe
      confirmation -> conflict/advisory resolution -> disconnect works
      end-to-end, following the Phase 2E checklist above.
- [ ] Hosted logs and audit entries contain no OAuth tokens, raw provider
      payloads, Gmail history, mailbox labels, directory data, or sent-message
      activity.

## 8. Verification status notes

- Normal `pnpm verify` must stay deterministic and must **not** depend on live
  Google credentials, OAuth redirects, Vercel, or provider network availability.
- Live Google checks are explicit, opt-in smoke tests only.
- Treat this checklist as the human acceptance gate for operator-facing Google
  setup: APIs enabled, consent screen scopes correct, callback URLs correct, env
  vars present, local flow works, hosted flow works, and logs remain secret-safe.
