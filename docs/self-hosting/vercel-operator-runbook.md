# Operator-Owned Vercel Runbook

This is the supported self-hosted shape for Tendnote: the operator's own
Vercel deployment, with the operator's own provider accounts and secrets. It
is a narrow, worked admission path for one household. It is not a hosted
service, a multi-tenant installation, or a general deployment promise.

The runbook is executable documentation, but its values are deliberately
synthetic. Replace each placeholder in the private Vercel environment with
the operator's own value; do not commit those values or paste them into an
issue, pull request, log, or public example.

## Supported boundary and prerequisites

Before configuring admission, the operator owns and has separately verified:

- a Vercel project for the Web deployment and the Vercel routing required for
  the Eve service (`/eve/v1/**`); use the repository's existing Vercel
  configuration rather than inventing a second platform adapter;
- a transaction-capable Neon Postgres database (`DATABASE_URL`) and a
  Redis-compatible service (`REDIS_URL`), both reachable from the Vercel
  runtime;
- one canonical HTTPS Better Auth origin (`BETTER_AUTH_URL`) and one private
  production `BETTER_AUTH_SECRET`; Web and Eve must use the same auth secret,
  database, Redis, and canonical origin so they verify the same sessions and
  persisted Access Decisions;
- model access through the configured Vercel AI Gateway (for example,
  `AI_GATEWAY_API_KEY` and a chosen `TENDNOTE_AGENT_MODEL`);
- the OAuth application(s) used by the enabled Better Auth integrations, such
  as a Google OAuth client id, client secret, callback URL, and reviewed
  scopes; and
- a verified transactional mail sender, such as Resend, with
  `RESEND_API_KEY`, `TENDNOTE_EMAIL_FROM`, and
  `TENDNOTE_EMAIL_REPLY_TO` configured for the operator's domain.

These provider accounts, callback registrations, DNS records, quotas, and
secrets are operator work. See [Google setup](../google-setup.md), [transactional
email setup](../email-setup.md), and [background-job delivery](../background-job-delivery.md)
for the provider-specific parts. The application does not support an
unverified provider combination, and community self-host support has no SLA.

## Admission configuration

Admission is server-only. The exact policy variables are:

```text
# Hosted is the default when this variable is absent or unset.
TENDNOTE_ADMISSION_MODE=hosted

# Self-hosted is explicit and requires exactly one normalized email.
TENDNOTE_ADMISSION_MODE=self-hosted
TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL=owner@example.test
```

`owner@example.test` is a synthetic example, not a credential or a live
account value. In the operator's private Vercel environment, set the second
variable to the one Better Auth email that will be the configured bootstrap owner
for this deployment. Do not set a comma-separated list, an internal user id, a
hostname, or a Vercel account name.

The Web and Eve Vercel runtimes receive the same values for the shared auth and
state dependencies. These placeholders are intentionally synthetic; replace
them only in the private Vercel environment:

```bash
BETTER_AUTH_URL=https://app.example.test
BETTER_AUTH_SECRET=<private-32-character-value>
DATABASE_URL=<private-neon-connection-string>
REDIS_URL=<private-redis-connection-string>
```

Set all four values in both runtimes. `BETTER_AUTH_SECRET` must be at least 32
characters and must never be committed. `DATABASE_URL` must point to the same
transaction-capable Neon database, and `REDIS_URL` to the same Redis service;
separate values would make Web and Eve disagree about sessions or admission.

The policy is deliberately explicit:

- An absent `TENDNOTE_ADMISSION_MODE` means `hosted`. Hosted Private Beta
  Access continues to use Vercel Flags, and an unavailable Flags evaluation
  leaves an account pending unless a durable grant already exists.
- `self-hosted` is accepted only with one valid email. The configured address
  is normalized and compared with the authenticated Better Auth session email.
  A first visitor never wins by arrival order.
- Missing, invalid, or malformed self-hosted configuration fails closed. The
  operator gets a safe diagnostic; visitors receive the ordinary pending
  treatment, not deployment configuration details.
- A successful owner admission persists one
  `self_hosted_bootstrap` Access Decision. A matching Household Invitation
  persists a separate `household_invitation` decision at acceptance. An
  unrelated signup remains pending.
- Owner admission requires a **verified** email. Public credential signup issues
  an authenticated but unverified session, so a signup that merely matches the
  configured owner email stays pending until that email is verified — an attacker
  who guesses the owner address cannot claim the owner role without proving
  mailbox ownership. When a transactional mail sender is configured, the owner
  verifies from the emailed link. When none is configured, Better Auth surfaces
  the verification link in the server log
  (`[tendnote] Email verification link for <email>: <url>`) for the operator to
  open once. A social sign-in (GitHub/Google) whose provider reports the email as
  verified satisfies this without a separate step.

The same persisted Access Decision is the authority at both Web and Eve. Eve
does not trust a forged owner header or derive a second admission policy.

## Worked operator journey

Run the local checks against the checked-out commit before configuring a
production project:

```bash
pnpm install --frozen-lockfile
pnpm db:check
pnpm verify
```

From a trusted shell with `DATABASE_URL` pointed at the operator's private Neon
database, apply the committed schema before the first production deploy:

```bash
pnpm db:migrate
```

Review the target connection and migration output before continuing. This is an
operator-run database step, not a deploy button or an automatic platform
provisioner. Then, in the operator-owned Vercel project(s), configure the
canonical origin, transaction-capable database, Redis, model, OAuth, and mail
values listed above. Keep secrets in Vercel's private environment settings. Do
not create a deploy button, copy a secret into the repository, or assume a
container image or platform-neutral deployment path exists.

With `TENDNOTE_ADMISSION_MODE=self-hosted` and the synthetic email replaced by
the operator's real private value:

1. Deploy the checked-out, verified commit through the operator's Vercel
   project and sign in using the configured bootstrap-owner email, then verify
   that email (from the emailed link, or the `Email verification link` line in
   the server log when no mailer is configured; social sign-in with a
   provider-verified email needs no separate step). Once the session is verified,
   Web admits the owner and persists `self_hosted_bootstrap`; Eve admits the same
   session from that persisted decision. An unverified session that matches the
   owner email stays pending.
2. Sign up a different test address. It is authenticated but remains pending
   at Web and Eve. It does not become an owner merely because it arrived first
   or because the owner has not visited recently.
3. From the admitted owner's Household surface, create a Household Invitation
   for a mailbox the operator controls. Creating the invitation does not create
   membership or access early; the emailed capability remains live only for its
   bounded window.
4. Sign in as the invited address, open the live link, and accept it. The
   authenticated session email must match the invitation email after
   normalization. Acceptance atomically creates the active Household
   membership and the durable `household_invitation` Access Decision.
5. Reload Web and open Eve as the invited member. Both surfaces admit from that
   persisted decision. Replaying the link is idempotent; an expired, cancelled,
   mismatched, or otherwise unusable link retains the same opaque recipient
   refusal.

To check the hosted boundary, omit `TENDNOTE_ADMISSION_MODE` in a separate
synthetic environment. The policy is hosted, and an unavailable Vercel Flags
evaluation keeps an ungranted visitor pending at both Web and Eve. Never use
Flags absence, a hostname, a Vercel account, or deployment failure as a signal
to switch into self-hosted mode.

## What this does not promise

This guide promises only the operator's own Vercel deployment and the provider
combination the operator has verified. It does not promise a deploy button,
container image, platform-neutral path, multiple independent owners, a
multi-tenant hosted service, or support for an unverified provider combination.
Those would require separate product and architecture decisions.

The contract behind this runbook is [ADR 0235](../adr/0235-self-hosted-admission-uses-an-explicit-email-policy.md),
with the Vercel scope in [ADR 0225](../adr/0225-self-hosting-is-scoped-to-the-operators-own-vercel-deployment.md)
and the household boundary in [ADR 0232](../adr/0232-self-hosted-admission-is-explicit-and-household-bounded.md).
