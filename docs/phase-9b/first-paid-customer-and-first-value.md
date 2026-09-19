# First paid customer and first-value promise

Decision artifact for [Define the first paid customer and first-value
promise](https://github.com/nick-neely/tendnote/issues/565). It fixes who the
first paid hosted release is written for, which job it promises, what counts as
First Value, what an unaided newcomer must accomplish, and which signals record
it. It does not decide billing ownership, the cost and reliability evidence
contract, the walkthrough protocol, hosted privacy obligations, or a telemetry
provider; those remain with their own tickets, listed at the end.

## Facts this decision rests on

- No one outside the author has requested a hosted Tendnote, and no intake
  channel exists. The customer is chosen, not read off requests. Learning is the
  build rationale; nothing here is demand evidence.
- The hosted product has no forced onboarding. A new account lands on Home with
  an empty Today rail, an Eve composer inviting a first capture, and an empty
  People list. Self Context onboarding is optional and never auto-entered.
- Household collaboration has not been exercised with a second person, and
  accepting a Household Invitation grants Private Beta Access in the same step.
- No product analytics exist. ADR 0165 defers user-facing productivity
  analytics; it says nothing about operator-facing activation signals.
- Google Contacts is the only import that populates People, and every provider
  connection is opt-in and needs OAuth consent.

## Launch Customer

The first paid release is written for one persona, the **Launch Customer**: an
individual adult with a full personal and professional life who wants to keep
what people tell them and reach out at the right time, and who need not care
how Tendnote was built. They arrive through a product-led marketing site or
word of mouth. The promise and the site assume a stranger.

Technical readers arriving from the README and Canonical Case Study are the
expected early arrivals and are served, but they are not the addressee: they
can self-host for free, so what they buy is zero operations. A pair or
household is not the addressee until Household has been exercised with a second
person. People the author knows are not the addressee because self-service
admission is the point; an uncoached acquaintance may still serve as a
walkthrough participant.

## The job and the promise

Tendnote's category is the **Personal OS**: a private, multi-domain operating
layer for one person's life. The first-value promise leans on its founding
domain, relationship memory and follow-up: keep what people told you and get
nudged to reach out at the right time. General Actions, Routines, Assets, and
Household coordination are included and may be shown, but they are not what
first value is measured against. Career memory is the named next domain and is
not promised.

Direction for later copy, not final wording: a Personal OS that starts with the
people in your life. The marketing ticket owns the claims.

## Individual expectation, Household deferred

The Launch Customer buys Tendnote for themselves. Household stays available and
documented, First Value is reachable solo, and the site never promises a
Household outcome. Whether an invited Household Member needs their own payment
is decided by [Decide subscription ownership and paid-access
lifecycle](https://github.com/nick-neely/tendnote/issues/567); nothing here
withholds invitations or pre-empts that answer.

## Existing capabilities, launch-quality experience

Capabilities are frozen for the first paid release: no new domains, no new
integrations, no new Eve tools. The newcomer experience is open. Onboarding
copy, empty-state direction, a skippable first-run path, first-run prompts, and
polish are expected, and the bar is launch quality rather than what sufficed
for a private beta. The prototype ticket carries this standard.

## First Value

**First Value** is reached when, in their first sitting, the newcomer has:

1. a real person saved,
2. a Memory about that person they confirmed,
3. a Follow-Up about that person they scheduled and have seen where it will
   resurface (person page, agenda, or Today), and
4. asked Eve about that person and received a grounded answer built from what
   they said.

Steps 1 to 3 are the setup loop; step 4 is the give-back that makes the loop
believable before they leave. The first reminder or Daily Brief actually
arriving is the **Return**; it cannot happen in one sitting and is a day-two
readiness check, not part of the milestone.

A first capture that is life admin rather than a person ("renew my passport")
does not count toward First Value. The product must accept it gracefully and
steer the next capture toward a person, never reject or hide it.

## No integration dependence

First Value must be reachable with manual capture alone. Google Contacts
import, Calendar, Gmail drafts, and Discord capture are offered after First
Value as accelerants. The walkthrough therefore carries no OAuth failure mode.

## Time and device

Design targets, not evidence claims: under fifteen minutes from payment
confirmation to First Value, in the first session, on the newcomer's own
everyday device. At least one Newcomer Walkthrough runs on a phone because
Today is the mobile home; the path must work on desktop and phone alike.

## The unaided standard

A **Newcomer Walkthrough** passes when someone who is not the author reaches
First Value with zero author explanation from the public landing page through
checkout, admission, and first use. The marketing site, in-app copy, the
first-run path, and Eve are the only help. The author observes and may ask
"what are you thinking?" but never answers. One intervention fails the run and
is logged as a defect to fix before the next run.

Two clean passes by different people is the target; one is the floor the
roadmap already states. The first-run path supplies the prompt (who did you
talk to this week?), so a run starts with nothing but the URL. Recruitment,
payment mode, observation notes, and the day-two Return check are protocol,
owned by [Prototype self-service signup through first
value](https://github.com/nick-neely/tendnote/issues/569). The walkthrough is a
launch-readiness check, not demand evidence.

## Activation Milestones and telemetry

Tendnote records a small fixed set of content-free, per-account
**Activation Milestones** as timestamps: first person created, first Memory
confirmed, first Follow-Up scheduled, first grounded Eve answer, and First
Value reached. They are operator-facing, never shown to users as productivity
statistics, and remain the source of truth for whether First Value happened.
[ADR 0242](../adr/0242-activation-milestones-are-content-free-and-product-owned.md)
records that boundary next to ADR 0165.

A third-party product analytics or error-tracking provider is permitted in
principle and the owner named PostHog as a candidate; error tracking is part of
the motivation. Which provider, what may leave Tendnote, and how that is
disclosed is a separate decision constrained by the hosted privacy ticket. The
milestones do not depend on it.

## Hypothesis and disconfirmation

The promise is recorded as a hypothesis, with observable signals and no numeric
targets so nothing here is invented evidence:

- **Hypothesis:** a Launch Customer can reach First Value unaided in one
  sitting and keeps capturing because the Return is worth paying for.
- **Disconfirmed if:** newcomers still fail to reach First Value unaided after
  the defects from earlier runs are fixed; or early customers cancel before a
  second renewal without ever reaching the Return; or accounts that reached
  First Value make no capture in a later session before their first renewal.

## Glossary

`CONTEXT.md` gains Personal OS, Launch Customer, First Value, Newcomer
Walkthrough, and Activation Milestone.

## Hand-offs

- [Decide subscription ownership and paid-access lifecycle](https://github.com/nick-neely/tendnote/issues/567):
  individual purchase for oneself is the expectation; invitation billing is
  open.
- [Define the cost and reliability evidence needed for a paid offer](https://github.com/nick-neely/tendnote/issues/568):
  the representative workload starts from the First Value loop plus Return.
- [Prototype self-service signup through first value](https://github.com/nick-neely/tendnote/issues/569):
  build to the First Value definition, the fifteen-minute and phone targets,
  the launch-quality bar, and the unaided standard; define the walkthrough
  protocol and the day-two Return check.
- [Decide the hosted privacy and customer-lifecycle obligations](https://github.com/nick-neely/tendnote/issues/570):
  Activation Milestones need disclosure; any third-party provider is bounded
  by this ticket's obligations.
- [Define the complete marketing-site and demo experience](https://github.com/nick-neely/tendnote/issues/572):
  the Launch Customer, the Personal OS category, the relationship-loop promise,
  and "also included" framing for other domains.
- Hosted telemetry provider and data boundary: new ticket, blocked by the
  privacy ticket.

## Not decided here

Billing ownership, payment methods, the price, the walkthrough protocol and
payment mode, the telemetry provider, the exact first-run path, and any
marketing copy.
