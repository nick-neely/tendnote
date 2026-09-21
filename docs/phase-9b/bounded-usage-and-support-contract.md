# Bounded usage and the author-operated support contract

Decision artifact for [Define bounded usage and the author-operated support
contract](https://github.com/nick-neely/tendnote/issues/571). It fixes how a
hosted account sees and recovers from usage limits, what the one-person
operator promises and refuses to promise, how outages and payment incidents
are handled, which interventions the operator may make by hand, and what a
database recovery must do before customers are let back in. It builds on
[Cost and reliability evidence](cost-and-reliability-evidence.md) and
[Subscription ownership and paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md)
and leaves two areas explicitly unresolved, listed at the end, for targeted
technical verification rather than further discussion.

The numeric limits are not set here. They come from the heavy Representative
Month once [Run the approved baseline cost replay](https://github.com/nick-neely/tendnote/issues/578)
has run. Every limit below is a named parameter with a stated derivation.

## Facts this decision rests on

- The Fair-Use Budget, Fallback Model, Spend Breaker, Usage Ledger, and
  shedding order are decided
  ([ADR 0246](../adr/0246-hosted-inference-is-metered-content-free-and-shed-in-a-fixed-order.md)).
  The budget is soft and per cost category; crossing it moves Eve to the
  Fallback Model and defers extraction and embeddings in their pending state.
- Global recall composes exact (lexical) searches and semantic "related"
  searches separately (`packages/db/src/queries/global-recall.ts`), and the
  recall action charges the `embedding` cost category per query
  (`apps/web/src/app/actions/global-recall.ts`). Search is therefore metered,
  and query embeddings share one allowance with background indexing.
- Per-minute product rate limits already exist per cost category
  ([ADR 0070](../adr/0070-product-rate-limits-are-separate-from-auth-limits.md)).
  They are the burst layer. Nothing bounds a month.
- The lifecycle decision fixed seven-day dunning, period-end cancellation, a
  fourteen-day first-purchase guarantee, immediate revocation on refund or
  dispute, manual re-admission after a won dispute, and ninety-day Lapsed
  retention.
- The privacy decision fixed one support address, a two-business-day
  acknowledgement, and two-year support-mail retention, and routes breach and
  deletion-notice handling to
  [the runbooks ticket](https://github.com/nick-neely/tendnote/issues/582).
- Existing self-host support is community-only with no response commitment
  ([docs/support.md](../support.md)). That document stays as written for
  self-hosters; the hosted contract below is separate.
- The production Neon project's configured history retention is six hours
  (read from the project settings on 2026-09-16). No restore procedure or
  drill exists. Nothing in the schema records an account after deletion, so a
  restore today would resurrect accounts deleted after the restore point.
- The operator has full database access. No technical control prevents the
  operator from reading customer content; safeguards are procedural and
  audited.

## Usage states the customer sees

A customer never reads token tables or percentages. Each metered function
shows one of three states, the reason, and its recovery condition.

| Function | Normal | Reduced | Paused |
| --- | --- | --- | --- |
| Eve conversation | default model | Fallback Model | no new turns |
| Search | exact and semantic results | exact results only, with a notice | semantic search unavailable, lists browsable |
| Capture processing (extraction and embeddings) | runs | never reduced | deferred, stays pending |
| Scheduled workflows (briefs, reviews, agenda, aftercare) | delivered | never reduced | next delivery skipped, with a notice |
| Reminders | delivered | never reduced | never deliberately shed |

"Reduced" exists only where a cheaper substitute exists: the Fallback Model for
Eve and exact-only results for search. Reminders are never deliberately shed;
that is not a delivery guarantee.

**Recovery conditions.** Every reduced or paused notice states exactly one:

- "Resets on <date>": the Usage Period reset, shown for the Fair-Use Budget
  and the Account Ceiling.
- "Resumes when service is restored", with no date: the Spend Breaker or an
  operator-declared incident.
- "Retrying": shown only when a queued job with a scheduled retry exists.

When several restrictions apply, the notice shows the most restrictive state
and that state's recovery condition. If the breaker is active, no billing date
is shown for any function it covers. When one restriction clears, the notice
is recomputed against the rest.

**Period.** Budgets and ceilings reset on the Usage Period: one month anchored
to the subscription's start day, for monthly and annual subscribers alike, not
the calendar month and not the Stripe billing period. The reset date is
displayed. See [The paid offer and price](paid-offer-and-price.md).

## The Account Ceiling

The Fair-Use Budget is soft. Above it sits the **Account Ceiling**: a hard
per-account monthly spend limit per cost category. Reaching it pauses that
function until the Usage Period resets. It changes pace, never access or tool
authority: records, reminders, export, billing, and cancellation keep
working.

The ceiling is derived, not chosen. It is the spend the price can bear for
one account after fallback usage, background work, and concurrent requests
are counted, using the heavy Representative Month and the margin the pricing
ticket records. There is no daily allowance at launch; the existing per-minute
rate limits are the burst layer. A daily allowance is added only if the Usage
Ledger shows a gap between per-minute limits and the monthly ceiling.

**Publication.** The fair-use page publishes the soft budget, the ceiling, and
the reason they differ, in understandable units (Eve turns, captures,
searches per period, derived from token figures at publication time). It does
not claim that ordinary use never reaches them; the Representative Month is
one synthetic workload.

## Support contract

The hosted support contract is separate from community support.

**The promise.** A substantive human reply within two business days of
receipt at the published support address. Receipt is the arrival time in the
support mailbox. The reply is due by the end of the second business day after
the day of receipt, in Central Time (America/Chicago), skipping weekends and
observed US federal holidays. Nothing else pauses the clock. Resolution
targets for billing, admission, export, and deletion requests exist
internally and are not published.

**Scope.** Accepted: account, billing, admission, export and deletion
requests, reproducible product bugs including Household permission bugs, and
model-quality reports. Model-quality reports receive a reply, not a correction
promise. Feature requests receive a reply and no delivery commitment.
Excluded: relationship or life advice, self-hosting operations (pointed at
[community support](../support.md)), and mediation between Household members.
Customers are never steered into public GitHub Issues with private details;
bug reports go to the support address.

**Refunds under the fourteen-day guarantee.** Requested by email. Eligibility
is judged by the request's arrival time. The normal workflow initiates the
refund in Stripe as part of the reply; if initiation fails, the reply says the
refund is pending. Funds timing is the card issuer's and is stated as such.
Refund handling is not a separate completion promise beyond the reply.

**Outages.** No service credits are offered. Any compensation for an outage
is at the operator's discretion, case by case, and is separate from the
fourteen-day guarantee. No uptime figure is published
([Cost and reliability evidence](cost-and-reliability-evidence.md)).

## Status visibility

A public status page lives on a static host independent of the product's
Vercel project and database, so it remains readable during the outage it
describes. At launch it carries operator-written Service Notices only; the
operator edits a file and pushes. Automatic publication of the synthetic
First Value check is deferred: it needs its own credentials, its own
deployment path, and a stale-or-unknown state produced by a process that is
not the thing being monitored. That mechanism is not hand-waved; it is a
later ticket if the manual page proves insufficient.

The same Service Notice text is shown as an in-app banner while the product
is reachable.

## Operator visibility and alerting

No on-call. The internal stance is best effort during waking hours and is not
published. Alerts reach one channel (email plus phone push) for exactly:

- the three Reliability Indicators from the cost and reliability decision,
- a Spend Breaker trip,
- a Stripe webhook reconciliation failure,
- a new support email.

Alerts are deduplicated per condition, and a recovery notification is sent
when a condition clears. Backlog growth during deliberate shedding is expected
and does not raise the backlog alert.

## Operator Actions

The operator may change a customer account by hand only through the following
**Operator Actions**, each performed by a documented runbook procedure and
each producing an audit entry. There is no admin UI at launch.

| Action | Record produced | Scope |
| --- | --- | --- |
| Extend dunning once | Dunning extension grant naming the failed invoice, with an expiry | Overrides expiry of that invoice's dunning window only |
| Re-admit after a won dispute | Re-admission grant naming the resolved dispute | Void against any later dispute |
| Refund | Stripe refund; revocation scoped to the refunded subscription | A fresh subscription is unaffected |
| Raise the Account Ceiling for the current period | Ceiling override with expiry at period end | That period only |
| Temporary Suspension | Suspension record with reason and internal review date | See below |
| Termination | Termination record with reason | See below |
| Lift a suspension | Audited transition; history retained | |
| Legal Hold | Hold record naming the data it covers and its expiry | Blocks deletion of that data only |
| Delete on request | Deletion Record, then row deletion | See recovery |

**Admission Exceptions live inside their condition.** Each blocking condition
owns its own exceptions, and every exception names the specific event it
excepts. Dunning expiry is overridden only by a grant naming that invoice; a
later invoice failure starts a window the grant does not cover. A dispute
revocation is overridden only by a re-admission grant naming that dispute. A
refund revokes the refunded subscription only. Suspension and Termination have
no admission exceptions and end only by their own audited transition. Admission
is granted when at least one source admits and no unexcepted block is active.
Direct edits to the Stripe projection are prohibited; every operator change is
a record the projection reads, so reconciliation cannot overwrite it.
[ADR 0248](../adr/0248-admission-exceptions-live-inside-their-condition.md)
records this.

**Privacy Policy wording.** The policy describes actual access: the operator
has full database access, safeguarded by audited procedures, and reads customer
content only when the customer asks or an incident requires it. It does not
present the Operator Actions list as a technical restriction.

## Suspension and Termination

**Temporary Suspension** denies admission while a review is open. Sessions
are revoked; sign-in remains possible and lands in a restricted pending area
offering export, account deletion, and billing (cancel only). No resubscribe,
records, or Eve. Deletion is honoured unless a Legal Hold covers the data.
Household membership is preserved; the member's Household access is denied
until the suspension is lifted. The customer is told the account is under
review and hears from the operator at least every ten business days while it
remains so. The internal review deadline is ten business days; an unresolved
review gets a customer update and a new internal deadline, never an automatic
termination. Repeated updates do not license indefinite suspension; each
renewal of the deadline is audited with its reason.

**Termination** is permanent. Renewal is cancelled, sessions are revoked, the
restricted area offers export and deletion only, Household access is denied
with membership preserved, and the ninety-day retention clock starts. The
refund policy for an already-paid remainder is a counsel item on the Hosted
Obligations Register, not decided here.

**Billing during Temporary Suspension is unresolved.** Pausing Stripe
collection still generates invoices and leaves subscription status unchanged,
and it does not compensate already-paid suspension days
([Stripe: pause payment collection](https://docs.stripe.com/billing/subscriptions/pause-payment)).
Invoice handling, treatment of prepaid days, resumption behaviour, and
preservation of Stripe Tax on any adjustment need verification against
Stripe's actual behaviour before the policy is written. This is handed to a
research ticket.

## Recovery

**Published wording**, only after a passed drill: "Tendnote maintains a
verified seven-day database recovery window. Recovery is a whole-service
operation, not per account." No success guarantee and no per-point promise.
Raising the configured Neon history retention from six hours to seven days is
a launch checklist item; the published number is read from the verified
configuration.

**Deletion Records.** Before an account's rows are deleted, a Deletion Record
(account id, deletion time) is written to a **Recovery Journal** kept outside
the product database and confirmed. Only then are rows deleted. The record is
retained for a **Deletion Record Retention** period, a distinct parameter set
to cover every retained branch, snapshot, or backup that could resurrect the
account, not the Lapsed retention constant.

**Restore procedure**, in outline:

1. Restore into an isolated branch created with queues, crons, push, and
   outbound email disabled from creation.
2. Stop production writes and drain the Recovery Journal to a known point.
3. Apply every Deletion Record, including any that arrived during recovery,
   idempotently.
4. Reconcile admission against the full policy: Stripe subscriptions,
   refunds, and disputes from Stripe's API, plus suspension, termination,
   legal-hold, and grant records.
5. Prevent restored jobs from repeating already-completed effects (reminders,
   deliveries, emails).
6. Invalidate every session in the Better Auth session store and the Redis
   cache, and confirm by query.
7. Verify deleted accounts are absent and admission matches policy, then swap
   and re-enable outbound effects.

**Drill.** Run on an isolated copy of production before launch, and again
after any change to the Deletion Record, admission records, asset byte
storage, or authentication stores.

**Recovery Journal mechanics are unresolved.** The journal must survive a
database restore, but the owner rejected a second authoritative event store.
The open design is the simplest durable journal with explicit write ordering
and failure handling: where a deletion request is durably recorded if the
journal write fails so the recovery cron can retry it, how suspension,
termination, hold, and grant records reach the journal without the database
ceasing to be the operational authority, and how completed effects are
fenced after restore. This is handed to a research ticket.

## Glossary

`CONTEXT.md` gains Account Ceiling, Operator Action, Admission Exception,
Temporary Suspension, Termination, Legal Hold, Deletion Record, and Recovery
Journal.

## Hand-offs

- [Run the approved baseline cost replay](https://github.com/nick-neely/tendnote/issues/578):
  the heavy figure sets the Fair-Use Budget and the Account Ceiling.
- [Decide the paid offer and price from measured evidence](https://github.com/nick-neely/tendnote/issues/573):
  the margin that derives the ceiling; the published fair-use units.
- [Define the hosted incident, data-request, and deletion-notice runbooks and the pre-launch tabletop](https://github.com/nick-neely/tendnote/issues/582):
  the Operator Action runbooks, the restore drill, and the Service Notice
  procedure.
- [Define the complete marketing-site and demo experience](https://github.com/nick-neely/tendnote/issues/572):
  the support page, fair-use page, and status page link.
- Hosted Obligations Register: the termination refund policy and the Privacy
  Policy access wording, both counsel review.
- Research: billing semantics during Temporary Suspension.
- Research: Recovery Journal mechanics.

## Not decided here

The budget and ceiling numbers, the Deletion Record Retention value, billing
behaviour during Temporary Suspension, the Recovery Journal design, automatic
status publication, and the termination refund policy.
