# Hosted telemetry and data boundary

Decision artifact for [Decide the hosted telemetry provider and its data
boundary](https://github.com/nick-neely/tendnote/issues/575).

The owner selected hosted GlitchTip US as the preferred error service,
subject to proving sanitized capture, and Tendnote-owned funnel reports with
no third-party product-analytics service. For launch, GlitchTip reports carry
no account identifier or other customer-linked field. This is a planning
decision, not a deployed integration or a claim that capture is already safe.
The [qualification task](https://github.com/nick-neely/tendnote/issues/586)
records why an account-specific erasure inquiry is no longer needed.

## Purpose and collection boundary

Launch telemetry supports error diagnosis and a small conversion funnel.
There is no session replay, including on the fictional Marketing Demo, no
arbitrary click collection, and no customer content. The observed Newcomer
Walkthrough remains the way to investigate usability in depth.

Public activity has no persistent visitor identifier and is never joined to
authenticated account history. Public conversion ratios are approximate
activity ratios, not unique-person conversion rates. Tendnote-owned
authenticated funnel events may use a dedicated opaque account identifier,
never names, email addresses, relationship-record identifiers, or content.
Those events remain account-linked. GlitchTip error reports carry no account
identifier, user identifier, session identifier, or other customer-linked
field; this gives up account-level error lookup.

There is no advertising, cross-site tracking, visitor fingerprinting, or
analytics cookie. GlitchTip receives approved diagnostics only; conversion
events remain in Tendnote. No replay, tracing, general log ingestion, or
automatic behavioral capture is selected by this decision.

## Closed launch event set

| Surface | Event | Authoritative trigger |
| --- | --- | --- |
| Public | Page viewed | View of an approved public page |
| Public | Demo started | Start of the fictional Marketing Demo |
| Public | Demo completed | Completion of the fictional Marketing Demo |
| Public | Signup clicked | Activation of the public signup link |
| Account | Signup completed | Confirmed account creation |
| Account | Checkout started | Start of the checkout flow |
| Account | Payment confirmed | Confirmed server-side payment state |
| Account | Paid Access granted | Confirmed server-side admission state |
| Account | First person created | Product-owned Activation Milestone |
| Account | First Memory confirmed | Product-owned Activation Milestone |
| Account | First Follow-Up scheduled | Product-owned Activation Milestone |
| Account | First grounded Eve answer | Product-owned Activation Milestone |
| Account | First Value reached | Product-owned Activation Milestone |

Use fixed page and milestone names, never raw URLs, query strings, button
text, or record identifiers. Tendnote's Activation Milestones remain the
source of truth independently of optional telemetry, as required by
[ADR 0242](../adr/0242-activation-milestones-are-content-free-and-product-owned.md).

## Funnel reporting

Keep the small event set in Tendnote, using anonymous daily counters for
public activity and expiring account-linked events for the authenticated
funnel. Provide simple saved operator reports; a general analytics dashboard
or a second analytics service is not part of the launch choice.

Reports distinguish the public activity ratios from the authenticated
signup-to-First-Value funnel. Account stages count the account reaching the
stage rather than duplicate deliveries of an event. Confirm payment and
admission from authoritative server state, not a successful browser redirect.
The report must make its optional collection coverage clear: opt-outs,
region suppression, blocked collection, and delivery failures can all make
the telemetry incomplete. It is not a billing or admission ledger.

## Diagnostic boundary

Allowed error fields are predefined error codes, sanitized stack locations,
release version, operation name, and coarse browser/runtime information.
Exclude all account, user, and session identifiers; raw exception messages,
console output, request bodies, headers, breadcrumbs, and customer content.
The owner accepts reduced diagnostic detail in exchange for a testable
boundary. Existing raw application logging is not safe to forward wholesale.

Implement one explicitly allowed outbound diagnostic envelope. For browser
errors, sanitize before sending to Tendnote, then validate and forward from
the server without copying the incoming request's headers, URL, IP address,
or user-agent string. Do not rely on a provider's post-ingestion scrubber to
enforce what may leave Tendnote. Automatic SDK integrations must not append
extra payload fields. This is an implementation requirement, not a claim that
the current SDK has been configured or verified.

GlitchTip supplies the grouped-error investigation and triage workflow.
Collection must not block customer actions. Enabling its alerts must respect
the existing [operator alerting contract](bounded-usage-and-support-contract.md#operator-visibility-and-alerting),
rather than introducing an alert for every exception or an on-call promise.

## Retention and customer control

| Data | Launch retention and deletion policy |
| --- | --- |
| Tendnote account-linked funnel events | Delete from live storage after ninety days, or immediately on account deletion |
| GlitchTip error events | Provider's documented ninety-day event retention; no account identifier is sent, so account-specific deletion is not offered. Account deletion stops future capture. |
| Anonymous daily totals in Tendnote | Thirteen months; fixed low-detail count dimensions only, without identifiers or a mapping back to accounts |
| GlitchTip backups | Provider documents daily snapshots retained for seven days, separate from event retention |
| Tendnote database backups | Follow the shared backup/deletion policy being reconciled in the existing backup decision |

The ninety-day period is active-storage retention, not a promise that every
backup copy disappears at that instant. Archives that remain usable as event
storage are not automatically exempted as backups. Provider metadata and
archive retention must be described accurately. The telemetry policy does not
change the separate retention rules for Activation Milestones, Usage Ledger,
audit records, billing records, or support email. Derive local enforcement
and public retention copy from the same canonical constants, following the
hosted privacy decision.

Collect optional telemetry only when the request's region is known to be US.
Suppress collection for other and unknown regions before anything is sent to
a telemetry provider. Public marketing pages remain accessible globally.
For asynchronous conversion events, eligibility must come from the relevant
user action, not the location of a webhook sender or Tendnote's server. If
eligibility cannot be established, suppress the optional telemetry copy;
payment, admission, and their necessary records continue normally.

One customer setting disables account-linked analytics and third-party error
reporting. Tendnote continues to record its own Activation Milestones and
necessary operational records. Account deletion stops optional collection
immediately and erases linked Tendnote-owned funnel events. Previously sent
GlitchTip reports remain until the provider's ordinary retention expiry;
the product must disclose this and must not promise per-account erasure there.

Check collection eligibility before forwarding queued events as well as when
capturing them, so a stale queue cannot defeat an opt-out or deletion. Do not
backfill an opted-out customer's optional funnel from the product-owned
Activation Milestones. Opting out stops future optional collection; account
deletion also erases linked history under the policy above.

## Preferred error service and remaining qualification

The owner selected hosted GlitchTip as the preferred error-tracking service,
subject to proving sanitized capture. Dedicated aggregation,
inspection, and triage of errors are valuable launch capabilities; simple
database queries are not an agreed replacement for that workflow.

GlitchTip documents US hosting, ninety-day event purging, and daily snapshots
retained for seven days. This distinguishes active retention from a backup
tail; it does not establish immediate account-specific erasure. See
[hosted architecture](https://glitchtip.com/documentation/hosted-architecture/).

The provider's issue-deletion API does not support a reliable account-specific
erasure workflow. The owner removed account identifiers from outbound error
reports rather than making that workflow a launch prerequisite. The cost is
losing account-level diagnostic correlation. If the implementation cannot
prove that reports contain no customer-linked fields, this decision must be
reopened before GlitchTip is enabled. See the
[qualification record](glitchtip-erasure-qualification.md).

PostHog is the original candidate, but its documented retention does not fit
the approved policy: Free specifies one year and paid plans seven years;
neither window can be shortened, and retention is not a deletion guarantee.
See [PostHog's retention documentation](https://posthog.com/docs/data/events-retention).

Detailed current-provider findings and their limitations are recorded in
[the provider evidence](../research/phase-9b-hosted-telemetry-providers.md).

## Disclosure and remaining work

The Privacy Policy and Privacy & AI page must distinguish product-owned
Activation Milestones, optional funnel reporting, and third-party error
diagnostics. Name GlitchTip/Burke Software as the planned error processor,
describe the approved payload without customer identifiers, show the opt-out,
and disclose ordinary event retention separately from backup expiry. State
that already-sent unlinked error reports remain until normal expiry after an
account is deleted. Do not describe account-linked Tendnote funnel events as
anonymous or promise immediate deletion of provider reports.
Existing counsel review of the no-cookie-banner policy remains in place.

- [Qualify hosted GlitchTip's account-erasure contract](https://github.com/nick-neely/tendnote/issues/586)
  records the removed provider inquiry and the owner's revised no-identifier
  boundary. Reopen the provider or identifier choice if sanitized capture
  cannot be proven.
- [Reconcile backup deletion and recovery-window promises](https://github.com/nick-neely/tendnote/issues/585)
  includes the telemetry provider's separate backup window in the unified
  disclosure. This decision does not settle the existing conflict between
  Tendnote's one-day backup-deletion claim and proposed seven-day recovery.
- [Define the hosted incident, data-request, and deletion-notice runbooks and the pre-launch tabletop](https://github.com/nick-neely/tendnote/issues/582)
  covers containment if the outbound boundary is breached; it does not assume
  an account-specific provider erasure workflow.

Implementation verification must observe outgoing payloads for browser and
server errors; inject synthetic sensitive values into error messages, URLs,
headers, and breadcrumbs; prove those values do not reach GlitchTip; check
unknown/non-US suppression and opt-out; verify queue handling on deletion;
and prove both event deduplication and retention expiry. Assert that no
account, user, session, IP, URL, or other customer-linked value reaches the
provider in either normal or failure paths.

No provider has been contacted or provisioned, no paid plan has been approved,
and no customer data has been sent. Implementation and service setup remain
separate from this planning map.
