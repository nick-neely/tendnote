# Runbook: support requests

Handle everything that arrives at the one published support address, which
serves support, privacy, and non-user requests
([the support contract](../phase-9b/bounded-usage-and-support-contract.md#support-contract)).

The promise is a substantive human reply by the end of the second business day
after the day of receipt, in Central Time (America/Chicago), skipping weekends
and observed US federal holidays. Receipt is the arrival time in the support
mailbox. Nothing else pauses the clock.

## Trigger

A message arrives at the support mailbox. The operator alert channel sends a
"New support email" alert for each one
([ADR 0258](../adr/0258-operator-alerts-are-condition-episodes-sent-by-email-and-ntfy.md)).

## Preconditions

1. The support mailbox under **Support mailbox** is open.
2. Production's environment is on hand for any Operator Action the request
   leads to.

## Steps

1. **Tag the message and note its reply deadline.** Tag it by kind:
   `account`, `billing`, `privacy`, `non-user`, `bug`, `model-quality`,
   `feature`, or `out-of-scope`. A privacy or non-user request also gets the
   `tracked` tag, and stays open until its reply is sent.
2. **If it describes a possible security problem or leaked data**, open a
   Suspected Incident under the [incident runbook](incident.md) first, then
   reply.
3. **Reply by kind:**

   | Kind | Reply |
   | --- | --- |
   | Access, export, deletion, or correction by an account holder | Point them to self-service: export and deletion on the account page, or on the pending, restricted, or Lapsed page they land on. Correction is editing the record in the app. If they cannot sign in, follow [Delete on request](operator-actions/delete-on-request.md). |
   | Refund under the fourteen-day guarantee | Eligibility is judged by the message's arrival time. If eligible, run the [Refund](operator-actions/refund.md) in the same sitting, then reply that it is done, or that it is pending if it failed. When funds arrive is up to the card issuer. Say so. |
   | Other billing: a failed payment, cancellation, invoice | Cancellation is self-service through the billing portal and takes effect at the period end. A customer who needs more time on a failed renewal can get [one dunning extension](operator-actions/extend-dunning.md). |
   | A paused function from the Account Ceiling | Explain that it resets with the Usage Period. Raising it is the operator's discretion: [Raise the Account Ceiling](operator-actions/raise-ceiling.md). |
   | Request from someone without an account about data concerning them | Send the non-user acknowledgement below, unchanged. Do not search customer content, and do not contact any customer about it ([ADR 0247](../adr/0247-non-user-requests-are-neither-searched-nor-relayed.md)). |
   | Reproducible bug, including a Household permission bug | Reproduce it with synthetic data. File a GitHub Issue with no private details, and reply. Never ask the customer to file a public Issue. |
   | Model-quality report | Reply. There is no promise of a correction. |
   | Feature request | Reply. There is no promise to deliver it. |
   | Relationship or life advice, mediation between Household members, self-hosting operations | Reply that it is out of scope. Point self-hosters to [community support](../support.md). |
   | Outage compensation | No service credits are offered. Any compensation is the operator's choice, case by case. |

4. **Archive the message** once the reply has been sent. A `tracked` message is
   archived only when its reply is sent.

### Non-user acknowledgement

> Thank you for writing. Tendnote stores notes on behalf of the people who use
> it, and only they control them. We do not search customers' notes in
> response to requests from other people, and we do not pass requests on to
> customers, because either would tell you or others something about our
> customers that we have no right to share. We also cannot confirm who is
> asking. If you believe someone you know keeps notes about you in Tendnote,
> please ask them directly. They can change or delete their notes at any time.

## Record produced

The message, its tags, and the reply, in the support mailbox. Any Operator
Action it led to writes its own record. A support request changes no account by
itself.

## Verification

- Every message received two business days ago or earlier has a reply.
- Every `tracked` message is archived with its reply, or still open within its
  deadline.

## Rollback

A sent reply cannot be recalled. Correct it with a follow-up. Each Operator
Action has its own rollback.
