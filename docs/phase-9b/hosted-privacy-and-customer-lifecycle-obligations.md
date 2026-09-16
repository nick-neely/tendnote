# Hosted privacy and customer-lifecycle obligations

Decision artifact for [Decide the hosted privacy and customer-lifecycle
obligations](https://github.com/nick-neely/tendnote/issues/570). It fixes who
the customer contracts with, who is eligible to buy and how that eligibility is
enforced, which legal documents exist at launch and how acceptance is recorded,
what Tendnote does when someone who is not a customer asks about their data,
what the service promises about retention and deletion, which sub-processors
touch customer content, and which channels carry a privacy or lifecycle
request. It does not write the policy text, choose the telemetry provider, set
the price or the support contract, design the marketing pages, or answer the
questions that need counsel or an accountant; those remain with their own
tickets, listed at the end.

## Facts this decision rests on

- Account deletion already exists and is household-aware. Better Auth's
  `deleteUser.beforeDelete` hook (`apps/web/src/lib/auth/server.ts`) runs the
  disposition table in
  `packages/domain/src/household-account-deletion.ts`, which decides per record
  family what is deleted with the account and what stays with the household.
  The deletion promise below is written to match that table, not to describe an
  aspiration.
- No geo-block code exists. ADR 0226 states that hosted Tendnote is US-only and
  blocks the EU, but nothing in `apps/web` enforces it today. The enforcement
  described here is new work, not documentation of existing behavior.
- No privacy policy or terms page exists in `apps/web`. There is nothing to
  amend; the launch document set is written from zero.
- The existing legal documents in `docs/legal/` name **Neely Solutions LLC** as
  the contracting party, and the CLA packet is versioned, counsel-reviewed, and
  dated in the repository ([docs/legal/README.md](../legal/README.md)). That is
  the precedent the hosted documents follow.
- Hosted sub-processors today are Vercel (hosting, flags, queues), Neon
  (Postgres), Resend (email), Google APIs only when a customer connects them,
  and the model provider reached through the Vercel AI SDK. Better Auth is an
  auth library in the deployment, not a processor. Stripe and a telemetry
  provider are pending decisions.
- The Neon project's point-in-time history retention is currently six hours
  (`history_retention_seconds: 21600`). That is the real window in which
  deleted rows remain recoverable from the database's own history.
- [docs/support.md](../support.md) promises community-only support today, with
  no service level and no response time. The hosted service's response promise
  is a new commitment that does not exist yet.
- [ADR 0223](../adr/0223-audit-log-retention-and-internal-read-boundary.md)
  retains audit entries for two calendar years and keeps raw audit reads
  internal.
- The map already fixed ninety-day Lapsed Account retention, a two-business-day
  email reply promise, a fourteen-day money-back guarantee, and period-end
  cancellation
  ([Subscription ownership and paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md),
  [Cost and reliability evidence for a paid offer](cost-and-reliability-evidence.md)).
  This decision states them as published promises rather than reopening them.

## The contracting party

The Terms of Service and the Privacy Policy name **Neely Solutions LLC** as the
party and Tendnote as the product. Stripe operates under the LLC, and the
statement descriptor reads `TENDNOTE`, because the name a customer recognizes
on a card statement is the name on the marketing site, not the name on the
filing. This matches the CLA packet, which already contracts as the LLC, so a
contributor and a customer deal with the same legal person.

Whether the LLC needs a DBA or trade-name filing to trade as Tendnote is a
professional-review item and is not decided here. It appears in the register
with a counsel review route.

## Eligibility and how it is enforced

The contractual rule is one line: a hosted customer is a United States resident
who is eighteen or older. Eighteen-plus is chosen deliberately to sidestep
children's privacy law rather than to build parental consent machinery, which
is a compliance workstream of its own and would be absurd for a service with
one customer.

Enforcement is layered, and the layers are described honestly as a filter
rather than as a legal shield. Someone determined to reach a US-only service
from Europe can. The point of the filter is that Tendnote is not knowingly
offering the service where ADR 0226 says it will not yet operate.

**Edge refusal.** A proxy at the edge refuses requests from the EU, the EEA,
the UK, and Switzerland using Vercel's request-country header. It covers
sign-up, sign-in, checkout entry, and every authenticated app route. Marketing
pages stay readable everywhere, because refusing to let someone read about the
software would also refuse to let them find the self-hosting path. A blocked
visitor sees a region page that says where the service operates and links to
self-hosting.

**Hosted only.** The **Region Block** runs only in hosted admission mode. A
self-hosted deployment never inherits it, for the same reason no Stripe code
path runs there: geography is a hosted business constraint, not a property of
the software. A self-hoster in Berlin is unaffected.

**Payment refusal.** Stripe Checkout restricts the billing country to the US. A
non-US card is refused before payment rather than refunded after, which keeps a
mistaken purchase from becoming a support event and a reversal.

The two layers fail differently on purpose. The edge header is cheap and
catches the common case; the billing country is the one that costs money to get
wrong.

## The launch document set

Two documents exist at launch, both reviewed by counsel before publication:

- **Terms of Service**, with the refund and fourteen-day guarantee, acceptable
  use, and eligibility as sections rather than as separate documents.
- **Privacy Policy**, including the sub-processor list and the retention table.

There is no Data Processing Agreement at launch. A DPA is the artifact of a
business customer who is themselves a controller, and the hosted offer sells to
one individual at a time.

**Acceptance is clickwrap at account creation, before checkout.** A Household
Guest accepts the same terms, because a guest is a customer of the service with
no payment attached, not a sub-user of someone else's agreement.

An **Acceptance Record** stores exactly four things: account id, document key,
version, and accepted-at. No IP address. Collecting an IP to prove assent would
mean storing a new piece of personal data on every account in order to defend a
dispute that, at this scale, has no plausible counterparty. The account and the
timestamp are what a court would actually ask for.

Each published version carries an owner-set re-acceptance flag. When the flag
is set, the next sign-in shows a summary of what changed and blocks the app
until the customer accepts. The gate applies to Lapsed and guest accounts too,
because they are still parties to the agreement. Deletion and export stay
reachable without accepting: refusing new terms must never be a way to lose
access to your own data or to the exit.

The policy text is drafted later with counsel and versioned exactly like the
CLA packet in [docs/legal/README.md](../legal/README.md) - a dated, stated
version in the repository, so a change to what a customer agreed to is a
reviewed commit rather than an edit to a page.

## People described in a customer's records

This is the durable stance, and it is the ADR.

Tendnote's data class is unusual in the way ADR 0226 already described: every
account holds context about people who have no account, never agreed to
anything, and cannot be authenticated by the service. A **Non-User Data
Subject** may write to Tendnote and ask what it holds about them. The answer is
fixed:

- Customers control their own notes. Tendnote stores them on the customer's
  behalf.
- **Tendnote does not search customer content in response to a third-party
  request.** Reading every account's records looking for a name is itself a
  privacy violation, committed against every customer whose records were read,
  in order to answer someone none of them has authorized.
- **Tendnote does not relay the request to customers.** Relaying would reveal
  to the requester which customer holds information about them, or at minimum
  narrow it, which is a disclosure Tendnote has no right to make.

Every such request gets an acknowledgement within the two-business-day reply
promise, stating that explanation plainly rather than going unanswered.

Whether any US state law obligates more than this is
[research ticket #580](https://github.com/nick-neely/tendnote/issues/580). The
posture ships as written unless the research says otherwise, and the register
tracks that review rather than leaving it implicit.

This does not contradict ADR 0226. The Region Block defers EU data subject
rights; it does not eliminate US obligations, and ADR 0226 said as much.

## What the customer is responsible for, and what Tendnote promises

The Terms place the lawful basis for keeping notes about third parties with the
customer. That is the honest allocation: the customer decides who to write
about and what to write, and Tendnote cannot supervise it without reading it.

Against that, the product side commits to three things, chosen because each one
is provable from the code and the contracts rather than pleasant to say:

1. Customer content is never sold and never used for advertising.
2. Customer content is not used to train models.
3. The assistant reads only within the scopes the customer set.

The third is not a new promise. The existing privacy and approval boundaries -
deterministic scope before the Privacy Guard, sensitivity tiers, approval gates
on external sends - stay binding, and the Privacy Policy describes them in
plain language rather than inventing a parallel set of commitments.

## Retention

The retention table in the Privacy Policy is generated from a single domain
constant set, following the
[ADR 0221](../adr/0221-household-erasure-closes-the-recovery-window-it-opens.md)
pattern: the copy and the sweep read one value, so what the product promises
and what actually gets deleted cannot drift.

| Data | Retained |
| --- | --- |
| Active account content | While the account exists |
| Lapsed Account content | Ninety days from entering Lapsed, then deleted |
| Deleted account | Removed from the live database at deletion; gone from backups within one day |
| Billing records | Held by Stripe and the LLC for the period tax law requires; never contain content |
| Support email | Two years, matching the audit retention in ADR 0223 |
| Telemetry | Decided by [#575](https://github.com/nick-neely/tendnote/issues/575), with content-free as the floor |

The published backup window is one day. The real Neon setting is six hours, and
the register records it as monitored configuration rather than as the promise.
The gap is deliberate: promising the exact provider setting means every
provider change is a policy change. Raising the setting past the published
window is a reviewed change to a published promise, not a knob.

## The account deletion promise

Deletion is self-service and immediate. No waiting period, no cooling-off, no
forced export first. Export is offered on the same screen so that the customer
who wants their data can take it without deletion being blocked on doing so.

The promise states exactly what the code in
`packages/domain/src/household-account-deletion.ts` does, in the customer's
words:

- Private records and provider connections are deleted now.
- Household-native records stay with the household, under its Owners, per
  [ADR 0214](../adr/0214-household-native-records-are-owned-by-the-workspace.md).
- The departing person's name is removed from shared history.
- Backups age out within the stated window.

Writing the promise from the disposition table rather than from an ideal is the
whole point. A deletion promise that overstates what happens is a false
statement made to every customer at the most sensitive moment.

An active subscription is cancelled immediately on deletion, with no refund of
the remainder. This matches period-end cancellation elsewhere: the customer
keeps what they paid for, and choosing to leave early does not generate a
refund.

## The household boundary

Each hosted account is its own customer with its own agreement, guests
included. Household-native records belong to the workspace and are governed by
its Owners under ADR 0214.

The Privacy Policy explains the scopes plainly: private records are never
visible to other members; household and shared scopes are visible as the owner
set them; leaving a household takes your private records with you and nothing
else.

No new "household controller" legal category is created. Inventing one would
imply a joint-controller relationship between two individuals who signed
nothing of the sort, and would give a household authority over a member's
private records that the product deliberately does not give it.

## Sub-processors

The Privacy Policy lists every sub-processor with its purpose, and the list is
committed to the repository so that adding one is a reviewed change rather than
an environment variable.

| Sub-processor | Purpose | Status |
| --- | --- | --- |
| Vercel | Hosting, feature flags, queues | Live |
| Neon | Postgres | Live |
| Resend | Transactional email | Live |
| Model provider via the Vercel AI SDK | Inference | Live, terms under review |
| Google APIs | Only when a customer connects them | Live, customer-initiated |
| Stripe | Payments and tax | Pending |
| Telemetry provider | Product telemetry | Pending #575 |

Better Auth is a library running inside the deployment, not a processor, and
the policy says so rather than padding the list.

The model provider must offer written no-training and bounded-retention terms.
[Research ticket #581](https://github.com/nick-neely/tendnote/issues/581)
checks the specific configured path rather than the provider's marketing page.
A provider that cannot offer those terms is not eligible for the paid release,
which makes the no-training promise above a contractual fact rather than a
hope.

Google data stays under the existing minimized-state ADRs (0090, 0094, 0113,
0121) and the Google API user data policy. Nothing here widens that.

## Sales tax

Stripe Tax is enabled from launch, with threshold monitoring. Whether the LLC
must register in its home state before the first sale is an accountant-review
item, and the first sale does not happen before that answer exists.

## Contact channels

One published support address handles everything: support, privacy requests,
and non-user requests. Privacy and non-user requests are tagged and tracked to
the two-business-day reply promise. A separate privacy alias would be a second
inbox for the same person to forget to read.

No postal address is published, because Tendnote sends no marketing email and
therefore has no postal-address disclosure obligation to satisfy. That changes
the day a newsletter starts, and the register records it as the trigger.

## The email set at launch

- Account and sign-in email.
- Billing and dunning, sent by Stripe.
- Cancellation and refund confirmations.
- The deletion-notice sequence before the ninety-day Lapsed purge.
- Opted-in reminders.

Every message is content-free except reminders, which carry only what the
customer explicitly chose to be reminded about. There is no marketing email at
launch.

## The tracking boundary

The boundary is fixed here; the provider choice inside it belongs to
[#575](https://github.com/nick-neely/tendnote/issues/575):

- No third-party advertising and no cross-site tracking.
- No cookie banner, because the only cookies are strictly necessary ones plus
  content-free first-party-attributed telemetry. The absence of a banner is a
  consequence of the boundary, not a decision to skip one.

The telemetry ticket picks a provider that fits inside that boundary and adds
it to the sub-processor list.

## Breach handling

An internal incident runbook, defined by
[ticket #582](https://github.com/nick-neely/tendnote/issues/582), covers
triage, provider containment, evidence preservation, the notification decision,
and who makes it. It is exercised once before launch as a tabletop, because a
runbook that has never been read under pressure is a document rather than a
capability.

The public commitment is to notify affected customers by email without undue
delay, and to state plainly that Tendnote cannot notify non-users directly -
it has no contact details for them and, per the stance above, will not search
content to find any.

State-specific triggers and deadlines are research
([#580](https://github.com/nick-neely/tendnote/issues/580)) and get counsel
review before any wording about them ships.

## Hosted Obligations Register

Every commitment above, the mechanism that enforces it, its status, and who
reviews it. This is a planning table, not policy text.

| Commitment | Enforcing mechanism | Status | Review route |
| --- | --- | --- | --- |
| Neely Solutions LLC is the contracting party | Named in both launch documents; Stripe account under the LLC | Decided, unbuilt | owner-decided |
| Statement descriptor reads TENDNOTE | Stripe account setting | Decided, unbuilt | owner-decided |
| DBA or trade-name filing to trade as Tendnote | Filing, if required | Open question | counsel review |
| US resident, eighteen or older | Terms eligibility section | Decided, unbuilt | counsel review |
| EU, EEA, UK, Swiss requests refused | Edge proxy on Vercel request-country header, hosted admission mode only | Decided, unbuilt | owner-decided |
| Marketing pages readable everywhere | Region Block route scope excludes marketing | Decided, unbuilt | owner-decided |
| Blocked visitor sees a region page with the self-hosting link | Region page, built by [#572](https://github.com/nick-neely/tendnote/issues/572) | Decided, unbuilt | owner-decided |
| Non-US cards refused before payment | Stripe Checkout billing-country restriction | Decided, unbuilt | owner-decided |
| Terms of Service published at launch | Counsel-reviewed document, versioned in the repository | Decided, undrafted | counsel review |
| Privacy Policy published at launch | Counsel-reviewed document, versioned in the repository | Decided, undrafted | counsel review |
| No DPA at launch | Scope decision | Decided | counsel review |
| Acceptance before checkout, guests included | Clickwrap step in signup, built by [#569](https://github.com/nick-neely/tendnote/issues/569) | Decided, unbuilt | owner-decided |
| Acceptance Record holds account, document, version, time only | Schema shape | Decided, unbuilt | owner-decided |
| Re-acceptance gate blocks the app, never deletion or export | Owner-set flag per version; gate exempts the exit paths | Decided, unbuilt | owner-decided |
| Non-user requests neither searched nor relayed | [ADR 0247](../adr/0247-non-user-requests-are-neither-searched-nor-relayed.md), runbook in [#582](https://github.com/nick-neely/tendnote/issues/582) | Decided | agent research ([#580](https://github.com/nick-neely/tendnote/issues/580)), then counsel review |
| Acknowledgement within two business days | Support contract in [#571](https://github.com/nick-neely/tendnote/issues/571); tagged inbox | Decided, unbuilt | owner-decided |
| Customer holds the lawful basis for third-party notes | Terms clause | Decided, undrafted | counsel review |
| Content never sold or used for advertising | Terms and Privacy Policy; no advertising sub-processor | Decided, undrafted | counsel review |
| Content not used to train models | Provider contract terms | Decided, unverified | agent research ([#581](https://github.com/nick-neely/tendnote/issues/581)) |
| Assistant reads only within the customer's scopes | Existing scope enforcement and Privacy Guard, already built and tested | Enforced today | owner-decided |
| Retention table matches the sweep | Single domain constant set, ADR 0221 pattern | Decided, unbuilt | owner-decided |
| Lapsed content deleted after ninety days | Retention deadline plus background sweep | Decided, unbuilt | owner-decided |
| Deleted account gone from backups within one day | Neon `history_retention_seconds` currently 21600 | Monitored configuration | owner-decided; raising it is a reviewed change to a published promise |
| Support email retained two years | Mailbox policy, matching ADR 0223 | Decided, unbuilt | owner-decided |
| Billing records never contain content | Stripe integration carries no record data | Decided, unbuilt | accountant review |
| Deletion is immediate, self-service, no forced export | Existing `deleteUser.beforeDelete` hook and disposition table | Enforced today; UI by [#569](https://github.com/nick-neely/tendnote/issues/569) | owner-decided |
| Deletion promise matches the disposition table | Copy written from `packages/domain/src/household-account-deletion.ts` | Decided, undrafted | owner-decided |
| Deletion cancels the subscription immediately, no refund | Stripe cancellation in the deletion path | Decided, unbuilt | owner-decided |
| Household-native records stay with the household | ADR 0214 and the disposition table | Enforced today | owner-decided |
| Sub-processor list committed to the repository | Versioned list beside the Privacy Policy | Decided, unbuilt | owner-decided |
| Model provider offers no-training, bounded retention | Provider terms on the configured path | Unverified | agent research ([#581](https://github.com/nick-neely/tendnote/issues/581)) |
| Google data stays minimized | ADRs 0090, 0094, 0113, 0121 and the Google API user data policy | Enforced today | owner-decided |
| Stripe Tax enabled with threshold monitoring | Stripe configuration; pricing work in [#573](https://github.com/nick-neely/tendnote/issues/573) | Decided, unbuilt | accountant review |
| Home-state registration before the first sale | Registration, if required; blocks the first sale | Open question | accountant review |
| One published support address | Marketing site footer and both documents | Decided, unbuilt | owner-decided |
| No postal address published | No marketing email is sent | Decided | counsel review if a newsletter starts |
| Launch email set, content-free except reminders | Resend templates | Decided, unbuilt | owner-decided |
| No third-party advertising or cross-site tracking | Telemetry boundary handed to [#575](https://github.com/nick-neely/tendnote/issues/575) | Decided | owner-decided |
| No cookie banner | Strictly necessary cookies plus content-free first-party telemetry | Decided | counsel review |
| Notify affected customers by email without undue delay | Incident runbook [#582](https://github.com/nick-neely/tendnote/issues/582) | Decided, unbuilt | counsel review |
| Tabletop exercise before launch | [#582](https://github.com/nick-neely/tendnote/issues/582) | Decided, unbuilt | owner-decided |
| State breach triggers and deadlines | Wording follows the research | Open question | agent research ([#580](https://github.com/nick-neely/tendnote/issues/580)), then counsel review |

## Glossary

`CONTEXT.md` gains Acceptance Record, Hosted Obligations Register, Non-User
Data Subject, and Region Block.

## ADR

[ADR 0247](../adr/0247-non-user-requests-are-neither-searched-nor-relayed.md)
records the durable part: Tendnote neither searches customer content nor
relays a request in response to a non-user data subject, acknowledges within
the support promise, and holds that posture unless #580 finds a binding
obligation. The rest of this artifact is launch configuration that a later
decision may reasonably change; that stance is the one a future reader would
otherwise try to "fix".

## Hand-offs

- [Research US state privacy and breach-notification law applicability for
  hosted Tendnote](https://github.com/nick-neely/tendnote/issues/580): whether
  any state law obligates more than the non-user stance, and the state breach
  triggers and deadlines the public commitment must match.
- [Research model-provider training and retention terms behind the AI SDK
  gateway](https://github.com/nick-neely/tendnote/issues/581): written
  no-training and bounded-retention terms on the configured path; a provider
  without them is not eligible for the paid release.
- [Define the hosted incident, data-request, and deletion-notice runbooks and
  the pre-launch tabletop](https://github.com/nick-neely/tendnote/issues/582):
  the incident runbook, the non-user acknowledgement template, the
  deletion-notice sequence, and the tabletop.
- [Decide the hosted telemetry provider and its data
  boundary](https://github.com/nick-neely/tendnote/issues/575): picks a
  provider inside the tracking boundary fixed here, sets telemetry retention,
  and adds the provider to the sub-processor list.
- [Define bounded usage and the author-operated support
  contract](https://github.com/nick-neely/tendnote/issues/571): the published
  support address and the two-business-day response promise this artifact
  relies on.
- [Define the complete marketing-site and demo
  experience](https://github.com/nick-neely/tendnote/issues/572): the region
  page, the legal pages, the footer links, and the deliberate absence of a
  cookie banner.
- [Prototype self-service signup through first
  value](https://github.com/nick-neely/tendnote/issues/569): the clickwrap
  step, the re-acceptance gate, and the deletion screen with export beside it.
- [Decide the paid offer and price from measured
  evidence](https://github.com/nick-neely/tendnote/issues/573): Stripe Tax
  applies to whatever price it sets, and how tax is shown is its call.

## Not decided here

The text of the Terms of Service and the Privacy Policy, the telemetry provider
and its retention, the support address itself and the wording of the response
promise, the marketing and region page designs, the signup and deletion
interfaces, the edge proxy's implementation, whether a DBA filing is required,
whether home-state tax registration is required before the first sale, and
whether any US state law obligates more than the non-user stance recorded here.
