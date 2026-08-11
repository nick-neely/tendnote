# Transactional Email Setup (Resend)

> **Human-in-the-loop setup.** This guide creates the Resend account, verifies
> the sending domain, and adds the DNS records that let Tendnote's mail reach an
> inbox. None of it can be done by an agent or by code: it needs an operator with
> access to the Resend dashboard and the Cloudflare zone for `stacklet.app`.

Tendnote sends one kind of email today - a **Household Invitation**. It is
transactional in the strict sense: a person typed an address, an explicit Owner
action created a durable delivery attempt, and the message carries a capability
that person needs in order to act. There is no list, no marketing stream, and no
tracking.

Provider choice is an adapter detail (see
[`docs/phase-8/research/transactional-email-provider-reassessment.md`](phase-8/research/transactional-email-provider-reassessment.md)).
Everything provider-shaped lives in `apps/web/src/lib/email/resend.ts`; swapping
providers touches that file and the selection in
`apps/web/src/lib/email/transactional.ts`, and nothing else.

---

## 0. What you are setting up

| Thing | Value | Why this one |
| --- | --- | --- |
| Sending domain | `mail.stacklet.app` | A dedicated subdomain, so transactional reputation is earned and lost separately from anything the apex domain ever sends. |
| From address | `Tendnote <notifications@mail.stacklet.app>` | A real named sender, not `noreply@`. People answer a message about being invited into someone's home. |
| Reply-To | `support@stacklet.app` | The monitored inbox already routed by Cloudflare Email Routing, and the same address every household surface shows. |
| App origin | `https://tendnote.stacklet.app` | Where the invitation link points. Set by `BETTER_AUTH_URL`, never by an inbound `Host` header. |

**The apex domain is not touched.** `support@stacklet.app` keeps working exactly
as it does now: Cloudflare Email Routing owns the `MX` records on
`stacklet.app`, and every record below is on `mail.stacklet.app` or deeper.
Inbound routing and outbound sending do not collide.

---

## 1. Create the Resend account and the domain

1. Sign up at [resend.com](https://resend.com). The free tier covers 3,000
   emails/month and 100/day, which is far more than private beta needs.
2. Go to **Domains -> Add Domain**.
3. Enter `mail.stacklet.app`. Enter the subdomain, **not** `stacklet.app`.
4. Pick the region closest to the Vercel deployment. The region is baked into the
   DNS values Resend gives you, so decide before adding records.
5. Resend shows a table of DNS records. Leave that page open; section 2 is how to
   translate it into Cloudflare.

## 2. Add the DNS records in Cloudflare

Open the Cloudflare dashboard, select the **`stacklet.app`** zone, and go to
**DNS -> Records**.

**The name field is the trap.** Cloudflare names records relative to the zone
apex, and Resend names them relative to the domain you registered with it. Resend
will say `send`; in a `stacklet.app` zone that must be entered as `send.mail`.
Get this wrong and verification sits at "pending" forever with no error.

Every record below is **DNS only** (grey cloud). Cloudflare does not proxy `TXT`
or `MX`, but check the toggle anyway if you add a `CNAME` variant.

| # | Type | Cloudflare **Name** | Content | Priority | Purpose |
| --- | --- | --- | --- | --- | --- |
| 1 | `MX` | `send.mail` | the `feedback-smtp.<region>.amazonses.com` host Resend shows | `10` | The bounce return path. Without it Resend cannot see bounces and SPF cannot align. |
| 2 | `TXT` | `send.mail` | `v=spf1 include:amazonses.com ~all` | - | SPF for the return path. |
| 3 | `TXT` | `resend._domainkey.mail` | the long `p=MIGfMA0GCSqGSIb3...` value Resend shows | - | DKIM. **The dashboard is the authority here** - see the note below before you type anything. |
| 4 | `TXT` | `_dmarc.mail` | `v=DMARC1; p=none; rua=mailto:support@stacklet.app` | - | DMARC. See the rollout note below. |

Notes on each:

- **Record 1 and 2** must both exist and must both be on `send.mail`. Resend's
  own instructions call this host `send.<your-domain>`; the two records together
  are what make SPF align with the envelope sender.
- **Record 3 is the one to copy rather than transcribe.** As documented today,
  Resend issues DKIM as a *single* `TXT` record named `resend._domainkey`, which
  for a subdomain becomes `resend._domainkey.mail` in the Cloudflare name field.
  The value is one long string unique to your domain; Cloudflare accepts it whole
  and splits it internally, so do not add quotes or line breaks by hand.

  **If the Records tab shows you something else, believe the dashboard, not this
  table.** Resend's own API types allow a DKIM record to arrive as either `TXT`
  or `CNAME`, so the shape is theirs to change and may differ by region or by how
  the domain was created. Whatever it shows - one record or several, `TXT` or
  `CNAME` - reproduce every DKIM row's type, name, and value exactly, applying
  the same name rule as everything else here (drop the `.stacklet.app` suffix,
  keep the `.mail`). Verification will not pass on a record you invented.
- **Record 4** is optional for Resend's verification but not optional for
  deliverability. Gmail and Yahoo have required authenticated mail since February
  2024, and a domain with no DMARC record is treated worse than one with
  `p=none`. Because DMARC falls back to the organizational domain, a record on
  `_dmarc.mail` lets `mail.stacklet.app` carry its own policy without changing
  anything for `stacklet.app`.

**Set TTL to Auto (or 300s) while you are setting up.** Raise it once the domain
verifies and stays verified.

### Verify the records resolved

From any machine, after a minute or two:

```bash
dig TXT send.mail.stacklet.app +short
dig MX  send.mail.stacklet.app +short
dig TXT resend._domainkey.mail.stacklet.app +short
dig TXT _dmarc.mail.stacklet.app +short
```

If the dashboard gave you `CNAME` DKIM records instead, query those names with
`dig CNAME <name>.stacklet.app +short` rather than the `TXT` line above.

Each should print the value you entered. No output means the record is missing or
the name was entered relative to the wrong domain - re-read the name column
above.

Then press **Verify DNS Records** in Resend. The domain should move to
`verified`. If it does not, the record names are almost always the cause.

### DMARC rollout

Start at `p=none` and leave it there for at least a week of real sends. Read the
aggregate reports arriving at `support@stacklet.app`, confirm every source is
Tendnote, then tighten:

```
p=none  ->  p=quarantine; pct=25  ->  p=quarantine  ->  p=reject
```

Do not start at `p=reject`. A misconfigured record with a strict policy silently
destroys mail rather than warning you about it.

## 3. Create the API key

1. In Resend, go to **API Keys -> Create API Key**.
2. Name it for the deployment it belongs to (`tendnote-production`,
   `tendnote-preview`).
3. Set permission to **Sending access** and restrict it to the
   `mail.stacklet.app` domain. Tendnote never lists domains, reads emails, or
   manages contacts, so full access is a standing hazard for no benefit.
4. Copy the key. Resend shows it once.

**One key per deployment.** A preview deployment sharing production's key can
send as production, which is exactly the mistake that burns a sending domain's
reputation.

## 4. Set the environment variables

| Variable | Where | Required | Notes |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Vercel project env, or `apps/web/.env.local` | Yes in production | Its presence is what selects the Resend transport. |
| `TENDNOTE_EMAIL_FROM` | Same | No | Defaults to `Tendnote <notifications@mail.stacklet.app>`. Set it only for a deployment that must not send as production. |
| `TENDNOTE_EMAIL_REPLY_TO` | Same | No | Defaults to `support@stacklet.app`. |
| `BETTER_AUTH_URL` | Same | Yes in production | The origin the invitation link is built from. It must be the real HTTPS origin; the link is a capability and is never built from a request header. |

In Vercel: **Project -> Settings -> Environment Variables**. Add
`RESEND_API_KEY` to Production. Add a **separate** key to Preview, or leave
Preview without one - a preview deployment with no key refuses to send rather
than mailing real people from a branch.

### How the transport is chosen

`apps/web/src/lib/email/transactional.ts` decides, from the environment alone:

| Environment | `RESEND_API_KEY` | Transport |
| --- | --- | --- |
| `test` | anything | Operator log. The test runner never sends, whatever is in your shell. |
| any | set | **Resend.** A key is what turns real sending on, so a smoke test works anywhere. |
| not production | unset | Operator log: the message is written to the server log, link and all. |
| production | unset | **Refuses**, by name, naming the variable and this document. The attempt is recorded `failed` and the Owner is told delivery did not happen. |

The production refusal is deliberate. Falling back to the operator log there
would write a working household invitation into a hosted log, which is a live
capability somewhere the recipient's mailbox is not.

## 5. Smoke-test one send

Do this once, against an address you control, before anyone else is invited.

**Locally, without sending anything:**

```bash
cd apps/web && pnpm dev
```

Sign in, create a household, and invite an address from
**Account -> Household**. With no `RESEND_API_KEY` set, the whole message -
subject, body, and the acceptance link - is written to the `next dev` terminal.
Paste the link into a browser to walk the recipient's side.

**Locally, with a real send:**

1. Add `RESEND_API_KEY=re_...` to `apps/web/.env.local` and restart `pnpm dev`.
2. Invite an address you own.
3. Check the terminal for errors, then check the inbox.

**What to check in the message that arrives:**

- [ ] It landed in the inbox, not in spam.
- [ ] The sender reads `Tendnote`, the address is `@mail.stacklet.app`.
- [ ] Replying to it goes to `support@stacklet.app`.
- [ ] The **Join** button works and lands on `/join/...` at the right origin.
- [ ] The pasteable link below the button is the same URL.
- [ ] Open the raw source (Gmail: **Show original**) and confirm the
      `Authentication-Results` header shows `spf=pass`, `dkim=pass`, and
      `dmarc=pass`.
- [ ] Read it in a dark-mode client. It should be near-black under near-white,
      not an inverted grey.
- [ ] Read the plain-text alternative. It should say everything the HTML says and
      carry the link.

**In Resend:** the send appears under **Emails** with a message id. That id is
also stored on the delivery attempt row in `household_invitation_deliveries`, so
a support question can be traced from Tendnote's side without opening the
dashboard.

For a deliverability score beyond one inbox, send an invitation to a
[mail-tester.com](https://www.mail-tester.com) address and read its report.

## 6. After the first sends

- **Warm up gently.** A brand new sending domain should not jump to volume.
  Private beta invitation volume is naturally tiny, which is the ideal warm-up.
- **Watch bounces and complaints.** Keep bounces under 4% and complaints under
  0.1%. Resend suppresses hard bounces automatically.
- **Resend's event retention is 30 days.** Tendnote's own delivery attempt rows
  are the durable record; a provider dashboard is not the audit log.
- **Webhooks are not wired yet.** Tendnote records `sent` or `failed` at the
  moment of the call and does not yet consume `email.delivered`,
  `email.bounced`, or `email.complained`. Wiring them is a separate piece of
  work; until then, a bounce is visible in Resend but not in Tendnote.

## What Tendnote deliberately does not do

- **No open or click tracking.** The invitation link is a capability. A
  click-tracking redirect would hand a working household invitation to a third
  party's URL shortener. Leave Resend's tracking settings off.
- **No `List-Unsubscribe`.** This is a one-off message to an address a person
  typed, not a list anyone is on.
- **No retry inside the adapter.** The database claim in
  `dispatchHouseholdInvitationDelivery` decides an attempt happens exactly once;
  a retry under it would be a provider call nothing authorised. The attempt id is
  sent as Resend's idempotency key so an ambiguous network failure cannot become
  two messages.
- **No provider error text reaches an Owner.** Only the failure class is
  recorded. What Resend knows about a recipient - suppressed, bounced, unknown -
  is not the Owner's to read.
