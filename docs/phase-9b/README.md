# Phase 9b planning workspace

The canonical decision map is [Wayfinder: Phase 9b Commercialization](https://github.com/nick-neely/tendnote/issues/564).

## Shared branch and pull request

All durable artifacts for the entire map accumulate on `docs/phase-9b-wayfinder`
and one persistent draft pull request targeting `main`. This includes research,
grilling outcomes, prototypes, PRD and glossary changes, and warranted ADRs.
Do not create per-ticket branches or pull requests, including for research.

At session startup, inspect `git status`, fetch, switch to the shared branch,
and fast-forward from origin before editing. Preserve unrelated work; use a
clean checkout if switching would disturb it. Never reset or force-push to
resolve concurrent work.

Only one session writes or integrates the shared branch at a time. Research
may run independently, but its durable output is handed to that writer for
integration. Each ticket's artifacts receive their own logical commit and are
pushed to the same draft PR. Record the answer on the ticket and link the
published artifact, then close the ticket and index its resolution on the map.
Resolve at most one non-research ticket per session.

Keep the PR open and in draft across sessions until final specification
synthesis and review. Do not merge it after each ticket. Product implementation
and its delivery workflow follow this planning effort separately.

## Destination and rationale

Specify a small, real paid service operated by the author, including the full
marketing site and self-service discovery, demo, subscription, onboarding,
first value, billing management, and cancellation. Building and operating real
payments is an explicit learning goal; unprompted demand is no longer a build
prerequisite. The map records this owner-approved change to the earlier demand
gate. The observed newcomer walkthrough remains a launch-readiness check.

Decision detail belongs on the map's tickets. This directory is an artifact
entry point, not a second decision index.

## Artifacts

- [Local deterministic eval repair and evidence](deterministic-eval-repair.md):
  a clean 60/60 full run, preserved earlier failures and their harness repairs,
  a focused confirmation, measured costs, and qualification limits.

- [Baseline cost replay harness](baseline-cost-replay.md): the isolated synthetic
  workload, unpaid verification, spending reservations, web-search exclusion,
  and exact command awaiting separate paid-run approval.

- [Hosted telemetry and data boundary](hosted-telemetry-and-data-boundary.md):
  hosted GlitchTip as the preferred error service pending erasure qualification,
  Tendnote-owned funnel reports, a closed content-free event and diagnostic
  boundary, US-only collection, opt-out, and separate live/backup retention.
- [Hosted telemetry provider evidence](../research/phase-9b-hosted-telemetry-providers.md):
  GlitchTip capabilities and issue-deletion limits, the hosted archive and
  completion questions, and the PostHog/Sentry comparison.
- [Hosted GlitchTip erasure qualification](glitchtip-erasure-qualification.md):
  what public sources settle about hosted deletion, the owner's inquiry to
  the provider, the pass bar, an evidence record, and the three-tier
  disclosure template; awaiting the provider's written answers.
- [Marketing site and demo experience](marketing-site-and-demo-experience.md):
  the public page inventory, main-domain marketing and app-subdomain product,
  demo-first navigation, fictional scripted Marketing Demo, pricing
  disclosures, self-hosting alternative, and public claim boundaries.
- [Stripe subscription lifecycle constraints](../research/phase-9b-stripe-subscription-lifecycle.md):
  hosted Checkout and portal capabilities, payment-first access evidence,
  webhook idempotency and recovery, and the cancellation and refund choices
  still open.
- [First paid customer and first-value promise](first-paid-customer-and-first-value.md):
  the Launch Customer, the relationship-loop promise inside the Personal OS
  category, the First Value milestone, the unaided Newcomer Walkthrough
  standard, and content-free Activation Milestones.
- [Subscription ownership and paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md):
  Paid Access as a hosted admission source, one account per subscription, the
  first paid invoice as admission evidence, dunning, cancellation, refund and
  dispute policy, the Lapsed Account, the Household Guest exception, and the
  hosted account state machine.
- [Cost and reliability evidence for a paid offer](cost-and-reliability-evidence.md):
  the Representative Month, the content-free Usage Ledger, the profitability
  rule and Fair-Use Budget, the Fallback Model, the Spend Breaker's shedding
  order, the Reliability Indicators and support promise, the regression bar,
  and the first cost-bounded evaluation plan.
- [Hosted privacy and customer-lifecycle obligations](hosted-privacy-and-customer-lifecycle-obligations.md):
  the contracting party, US eighteen-plus eligibility and the Region Block, the
  two-document launch set and the Acceptance Record, the stance on Non-User
  Data Subjects, the retention table and the deletion promise, sub-processors
  and the model-provider condition, sales tax, the contact and email sets, the
  tracking boundary, breach handling, and the Hosted Obligations Register.
- [US privacy and breach-law applicability](../research/phase-9b-us-privacy-and-breach-law-applicability.md):
  state privacy thresholds as the current shield, note subjects as consumers,
  breach duties triggered by the credential store, scale-independent
  California obligations, and the counsel-review list.
- [Model-provider training and retention terms](../research/phase-9b-model-provider-data-terms.md):
  the configured gateway path, which providers meet the written no-training
  and bounded-retention bar, and the privity gap between provider commitments
  made to Vercel and promises Tendnote can make to a customer.
- [Self-service signup through First Value](self-service-signup-through-first-value.md):
  the owner-approved journey; the clickable prototype
  ([HTML](prototypes/self-service-signup-through-first-value.html)), the
  pending-area and confirming-page contracts, the first-run prompt, the
  Newcomer Walkthrough protocol, and the questions settled as prototyped.
- [The Household Guest experience](household-guest-experience.md): the
  owner-chosen read-only library; the three-variant prototype
  ([HTML](prototypes/household-guest-experience.html)), paid features absent
  rather than locked, the single subscribe link, the revised pending-area
  action set, and the name-nobody sponsor-lapsed and removal states.
- [Bounded usage and the author-operated support contract](bounded-usage-and-support-contract.md):
  the per-function usage states and recovery conditions, the Account Ceiling,
  the hosted support contract and refund workflow, the static status page,
  operator alerting, the audited Operator Actions and Admission Exceptions,
  Temporary Suspension and Termination, and the recovery procedure. Suspension
  billing is now settled in its own artifact; Recovery Journal mechanics went
  to research.
- [Stripe billing semantics during Temporary Suspension](../research/phase-9b-stripe-suspension-billing.md):
  why pausing payment collection is the wrong instrument, the preview-only
  pause endpoint, leaving Stripe untouched while the suspension record denies
  admission, one credit note for prepaid days on the audited exit, Stripe Tax
  on that adjustment, and the sandbox check and policy questions left open.
- [Billing during a Temporary Suspension](temporary-suspension-billing-policy.md):
  nothing touched in Stripe while a review is open, dunning left to run, the
  rule stated at suspension and the amount at exit, the Suspension Credit and
  its time-based arithmetic and instrument, refund revocation keyed to the
  Operator Action record, record-before-act ordering, mid-suspension
  cancellation, the refunded termination remainder, and the sandbox checks
  handed to launch evidence.
- [Recovery Journal mechanics](../research/phase-9b-recovery-journal.md):
  one private Vercel Blob store with an immutable blob per record, intent row
  then journal blob then deletion, cron retry when the journal write fails,
  marker-based cutover drain, narrow fencing that never suppresses reminders,
  the rejected stores, and the retention arithmetic against Neon's history
  window.
- [The paid offer and price](paid-offer-and-price.md): the accepted evidence,
  one plan at $20 a month or $200 a year, the Usage Period, the per-category
  Fair-Use Budget and Account Ceiling numbers, the fixed-cost break-even
  estimate, interval-specific refund and renewal terms, the deferred second
  plan and its trigger, and fair use published in approximate turns.
