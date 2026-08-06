# Household invitation delivery and abuse constraints

Research for [Research household invitation delivery and abuse constraints](https://github.com/nick-neely/tendnote/issues/359), 2026-08-05.

## Answer

Phase Eight should treat a household invitation as a Tendnote-owned, email-address-bound capability with its own lifecycle, not as an early `Household Membership` and not as a Better Auth organization. The invitation can precede a Tendnote account; acceptance is the atomic point that proves the invited address, checks the current household rules, and creates the active membership.

Use a transactional email provider behind a narrow Tendnote adapter. Resend is the best default candidate for this phase because it supplies sending-only API keys, verified-domain delivery, 24-hour request idempotency, and signed delivery webhooks with documented at-least-once behavior. Postmark is a credible alternative with strong transactional-message and suppression primitives. Amazon SES is viable when Tendnote wants to own more AWS delivery operations, but its per-region sandbox, production-access review, quota, and notification setup add work without a current product benefit. Provider choice must not leak into the invitation domain contract.

An owner pressing **Send invitation** or **Resend** is the explicit approval for that one external send. Phase Eight must not let Eve, scheduled work, or other automation originate household invitations, and must not turn an invitation into autonomous follow-up email.

## Required invitation contract

### Invitation and membership are different records

The durable invitation needs, at minimum:

- an opaque invitation id;
- `householdId`, inviter user id, and intended role;
- the original display email plus a comparison-safe normalized email (trim and case-fold only; do not invent provider-specific Gmail dot or plus-address rules);
- a digest of a cryptographically random secret, never the reusable plaintext secret;
- `createdAt`, `expiresAt`, terminal-state timestamps, and the last explicit resend time;
- delivery attempt identity, provider message id, and a small delivery status; and
- an invitation state that distinguishes `pending`, `accepted`, `declined`, `canceled`, and `expired`.

Pending invitations count toward the agreed eight-seat household capacity until they expire. Terminal invitations do not. A membership should be created or reactivated only inside successful acceptance; it should not be required to represent a recipient who has no Tendnote account yet.

This is a necessary change from the current foundation. [`household_memberships`](../../../packages/db/src/schema/app/households.ts) requires an existing Better Auth `user.id`, supports only `invited | active | removed`, and has no recipient email, token, expiry, decline, cancellation, or delivery state. [`inviteMember`](../../../packages/db/src/queries/households/lifecycle.ts) therefore creates an `invited` membership for a known user and does not send email. That seam is useful as migration evidence, but it is not the Phase Eight external-invitation model.

### Mailbox proof and acceptance

Acceptance must require all of the following:

1. a live, unconsumed invitation secret;
2. an authenticated Tendnote session;
3. a verified session email matching the invitation's normalized recipient address; and
4. an atomic recheck of invitation state, expiry, household capacity, the user's one-active-household rule, and any admission rule decided by the activation journey.

The current auth schema has an [`emailVerified`](../../../packages/db/src/schema/auth.ts) field, but the current [`emailAndPassword` configuration](../../../apps/web/src/lib/auth/server.ts) does not require email verification and sends password-reset links only to an operator log. Phase Eight therefore cannot infer mailbox ownership merely from an authenticated email/password session. Better Auth's own invitation guidance requires the emailed invitation id and a matching logged-in email, and recommends verified email for sensitive membership when custom delivery or unverified sessions are involved ([Better Auth organization invitation documentation](https://better-auth.com/docs/beta/plugins/organization#accept-invitation)). Tendnote can reuse Better Auth's identity proof while retaining its own household domain.

Acceptance must be a single transaction or equivalently fenced operation. Two concurrent accepts must not create two memberships or overfill the household. Cancel, decline, expiry, and successful acceptance must make every prior link permanently unusable.

### Token and link handling

Invitation secrets should be generated with a cryptographically secure random generator, be long enough to resist guessing (256 random bits is a conservative implementation target), be stored only as a digest, expire, and be single-use. These are direct applications of OWASP's URL-token guidance: random, sufficiently long, securely stored, expiring, and invalidated after use ([OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html#url-tokens)).

Build the invitation URL from Tendnote's configured canonical HTTPS origin, never from an inbound `Host` header. The acceptance page should set `Referrer-Policy: no-referrer`, avoid third-party assets and analytics that could receive the URL, and never log or place the secret in audit metadata. OWASP calls out trusted URL construction, HTTPS, referrer protection, and brute-force limits for emailed URL tokens ([OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html#url-tokens)). The existing shared auth baseline already requires an HTTPS `BETTER_AUTH_URL` in production and restricts trusted origins to it ([`createTendnoteAuthOptions`](../../../packages/auth/src/server.ts)).

The lifecycle ticket should choose the human-friendly expiry. Better Auth uses 48 hours by default for organization invitations ([Better Auth organization options](https://better-auth.com/docs/beta/plugins/organization#options)); that is a useful security baseline, not a Tendnote product decision. Resending should be an explicit owner action that rotates the secret, invalidates the old link, starts a new expiry window, and creates a new delivery-attempt id. Retrying one failed provider request is different: it must reuse the same attempt id and idempotency key so a network ambiguity cannot send duplicates.

### Non-enumeration

The invitation-creation response must not disclose whether the recipient:

- already has a Tendnote account;
- is admitted or pending Private Beta Access;
- belongs to another Household Workspace;
- has a pending invitation elsewhere; or
- is suppressed, bounced, or otherwise known to the email provider.

Use the same success-shaped response and approximately uniform request path for every syntactically valid email, then perform lookup and delivery asynchronously. OWASP recommends a consistent message and response time plus per-account abuse controls for email side-channel flows ([OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html#forgot-password-service)). The authenticated owner may see their own invitation's neutral lifecycle—pending, sent, delivery problem, expired, canceled—but not the recipient's Tendnote account or other-household state.

An acceptance page may explain a conflict privately after the recipient has authenticated and proved the invited address. Public token inspection must reveal no household name, inviter identity, recipient address, or membership state before that proof.

### Delivery, resend, and cancellation

Create the invitation and a durable delivery request together, then send outside the interactive request through the repository's established outbox/background-job style. The owner should get a truthful accepted-for-delivery state, not a claim that the message reached an inbox. A send adapter should accept an invitation delivery-attempt id, recipient, template data, and canonical acceptance URL and return a provider message id or typed failure.

For Resend, use the delivery-attempt id as the provider idempotency key. Resend deduplicates the same email request for 24 hours and returns the original result; reusing a key with a different payload is rejected ([Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)). Application state remains authoritative beyond that 24-hour provider window.

Subscribe only to operational events needed for invitation delivery: sent, delivered, delayed, bounced, complained, failed, and suppressed. Do not enable open or click tracking for household invitations. Resend webhooks are retried, delivered at least once, and may arrive out of order, so Tendnote must verify signatures, deduplicate by `svix-id`, and apply monotonic state transitions rather than treating event order as truth ([Resend webhook delivery guarantees](https://resend.com/docs/webhooks/introduction#faq)). A delivery failure must not reactivate or extend an invitation, and a delayed email arriving after cancellation or expiry must still lead to a dead link.

Cancel immediately invalidates the invitation without sending another email. Decline requires the same recipient identity proof as acceptance, invalidates the invitation, and should reveal only a neutral result to the inviter. Explicit resend should be unavailable for terminal invitations; the owner creates a fresh invitation instead.

## Abuse controls

Seat capacity is not an abuse limit. Repeated cancel/reinvite cycles could otherwise harass a recipient without ever exceeding eight occupied seats. Phase Eight needs independent, centrally owned budgets at these keys:

- inviter user id;
- household id;
- normalized recipient email (stored or keyed as an HMAC where the limiter does not need plaintext);
- source IP or equivalent trusted request fingerprint; and
- provider-wide delivery budget.

Charge the budgets before enqueueing delivery, and fail closed if the limit store is unavailable. Repeated requests for the same live invitation should not send automatically. The lifecycle/activation decisions should set conservative initial numbers and a cooldown for explicit resend, then keep those values in one policy module so production evidence can tune them without a migration.

The repository already has a fail-closed Redis-backed product limiter with per-request override support, but its closed cost-category registry has no invitation category ([`@tendnote/rate-limit`](../../../packages/rate-limit/src/index.ts)). Invitation delivery should earn a distinct category instead of borrowing the generic `provider-call` or `server-action` budget; recipient and household keys need to compose with the inviter/IP checks.

Escalation should be progressive: quiet cooldown messaging first, longer recipient suppression after repeated attempts, and operational review for broad abuse. CAPTCHA is a fallback for suspicious or unauthenticated surfaces, not the first control on an already-authenticated owner action. Never disclose which keyed limit fired when that would weaken non-enumeration.

## Audit and privacy boundary

Record domain transitions, not secrets or full provider payloads. The audit trail should capture invitation id, household id, actor id, action, timestamp, intended role, prior/new state, delivery-attempt id, and provider message id/error class when relevant. Required actions include create, delivery requested, resend, delivery failure/suppression, cancel, decline, accept, expire, and abuse-limit denial.

Do not put the plaintext token, acceptance URL, email body, or raw webhook payload into application logs or [`audit_log.metadata_json`](../../../packages/db/src/schema/app/audit-log.ts). The invitation record necessarily owns the recipient email while pending; terminal retention and redaction need an explicit lifecycle decision. Provider dashboards are not Tendnote's durable audit store: Resend documents 30-day email-data retention on standard plans, so any evidence Tendnote truly needs must be persisted narrowly in its own database ([Resend webhook data retention](https://resend.com/docs/dashboard/webhooks/how-to-store-webhooks-data)).

Bounces and complaints must suppress further automatic retries to that address. An owner can see a neutral delivery problem and correct or replace an invitation, but cannot use Tendnote to probe the provider's suppression history. Suppression override is an operational/support action, never an owner-facing bypass.

## Provider setup comparison

| Candidate | Primary-source constraints | Phase Eight fit |
| --- | --- | --- |
| **Resend** | Requires a domain Tendnote owns; recommends a sending subdomain to isolate reputation; supports SPF/DKIM verification, DMARC, sending-only API keys, 24-hour request idempotency, and operational webhooks ([domains](https://resend.com/docs/dashboard/domains/introduction), [API-key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [webhooks](https://resend.com/docs/webhooks/introduction)). | Recommended default. The explicit idempotency and TypeScript-friendly HTTP boundary fit the existing Vercel/Next.js deployment. Tendnote still owns durable state, retries outside 24 hours, and webhook deduplication. |
| **Postmark** | Requires sender verification, distinguishes transactional from broadcast message streams, exposes delivery/bounce/complaint webhooks and suppression lists, and rejects inactive recipients ([Postmark introduction](https://postmarkapp.com/developer/), [suppressions](https://postmarkapp.com/developer/api/suppressions-api), [API errors](https://postmarkapp.com/developer/api/overview)). | Strong alternative if transactional-email operations and stream separation are preferred. Tendnote must supply its own durable send idempotency because no equivalent provider guarantee is documented in the reviewed primary sources. |
| **Amazon SES** | New accounts begin in a per-region sandbox limited to verified recipients, 200 messages per day, and one message per second; production access must be requested, sender identities remain verified, and the sender must operate bounce/complaint handling ([SES sandbox and production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [SES notifications](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications.html)). | Viable but operationally heavier for this phase. Prefer only if Tendnote intentionally adopts AWS email infrastructure and its regional quota/event pipeline. |

For the recommended Resend path, production readiness means:

1. Verify a dedicated transactional sending subdomain such as `notify.<product-domain>` with SPF and DKIM; add DMARC and keep the visible From domain aligned. Gmail requires SPF or DKIM for all senders and recommends SPF, DKIM, and DMARC for reliable authentication ([Gmail sender guidelines](https://support.google.com/mail/answer/81126)).
2. Use a stable household-invitation From address and a monitored Reply-To address. Do not use an inviter's address as From.
3. Store a domain-restricted, sending-only API key and a separate webhook signing secret in environment-scoped secrets; never expose either to the browser.
4. Disable open/click tracking for security links, register the verified webhook endpoint, and test delivered, delayed, bounced, complained, failed, suppressed, duplicate, replayed, and out-of-order events.
5. Exercise a production-readiness matrix across Gmail, Outlook, Apple/iCloud, and a custom-domain mailbox, including spam placement, plain-text rendering, expired/canceled links, and replies.
6. Route Better Auth password reset through the same transactional adapter when Phase Eight makes email delivery production-grade, while keeping auth email policy separate from household invitation policy.

## Decisions this research unlocks

The existing [Define the Phase Eight household activation journey](https://github.com/nick-neely/tendnote/issues/356) can now decide signup/admission routing, conflict handling, and user-visible states against a concrete non-enumerating delivery boundary. The existing [Define the Household Workspace lifecycle and governance contract](https://github.com/nick-neely/tendnote/issues/357) can decide invitation expiry, terminal retention/redaction, resend cooldowns and budgets, and atomic capacity semantics.

No new child ticket is needed from this research: those two already-open decisions cover the newly sharp product questions, and the current blocker edges correctly hold them behind this evidence.

