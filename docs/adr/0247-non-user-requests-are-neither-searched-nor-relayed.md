# Non-User Requests Are Neither Searched Nor Relayed

ADR 0226 named the data class and deferred the jurisdiction that regulates it
most heavily: every hosted account holds context about people who have no
account, never agreed to anything, and cannot be authenticated by the service.
Blocking the EU defers those data subject rights. It does not stop a person in
the United States from writing to Tendnote and asking what the service holds
about them.

Two responses look cooperative and are both wrong. Searching every account's
content for a name commits a privacy violation against every customer whose
records were read, in order to answer a stranger none of them authorized, and
it cannot even be done correctly: the requester cannot be authenticated, so the
search would be run on an unverified claim of identity. Relaying the request to
customers is worse, because the act of relaying tells the requester which
customer holds information about them, or narrows it to a small set. That is a
disclosure about the customer that Tendnote has no right to make, and it is
made to precisely the person the customer may have had reason not to tell.

## Decision

**Tendnote does not search customer content in response to a third-party
request, and does not relay such a request to customers.** Customers control
their own notes; Tendnote stores them on the customer's behalf. The service's
role is custodial, and it does not act as a directory of who knows what about
whom.

Every request receives an acknowledgement within the hosted two-business-day
reply promise, stating that explanation plainly. Silence is not the policy;
refusal with a reason is.

The posture holds unless [research
#580](https://github.com/nick-neely/tendnote/issues/580) finds a binding
obligation under a US state privacy law, in which case it is revisited with
counsel rather than adjusted informally.

## Consequences

The limits are honest and published rather than implied. A person who is
described in someone's Tendnote records has no way to learn that from Tendnote,
and the Privacy Policy says so instead of implying a rights process that does
not exist.

The same reasoning applies to breach notification. Tendnote can notify affected
customers by email and cannot notify non-users directly, because it has no
contact details for them and will not search content to find any.

EU data subject rights remain deferred by the Region Block under ADR 0226, not
answered by this ADR. This decision covers the requests that reach a US-only
service, which ADR 0226 already said would still exist.

The Hosted Obligations Register tracks the pending review, so the stance is
recorded as a posture with a named research dependency rather than as a settled
legal conclusion.

References: #570,
[ADR 0223](0223-audit-log-retention-and-internal-read-boundary.md),
[ADR 0226](0226-hosted-tendnote-is-us-only-and-has-no-free-tier.md),
[ADR 0245](0245-paid-access-is-a-hosted-admission-source-owned-by-the-account.md),
[the decision artifact](../phase-9b/hosted-privacy-and-customer-lifecycle-obligations.md).
