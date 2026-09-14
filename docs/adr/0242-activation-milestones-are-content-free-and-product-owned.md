# Activation Milestones Are Content-Free And Product-Owned

The first paid hosted release needs to know whether a newcomer reached First
Value without the author watching every account. ADR 0165 deferred user-facing
productivity analytics, and ADR 0226 explains why leaked content is worse here
than in typical SaaS: it describes people who never accepted the risk. The
obvious path, a third-party analytics SDK as the record of activation, would
send behavioral events about that data class to a vendor before the privacy
obligations are settled.

## Decision

**Tendnote records Activation Milestones itself, and they carry no content.**
A milestone is a per-account timestamp for one fixed step: first person
created, first Memory confirmed, first Follow-Up scheduled, first grounded Eve
answer, and First Value reached. The set is small and closed; a new milestone
is a product decision, not a logging convenience.

Milestones are operator-facing. They are never shown to users as productivity
statistics, streaks, or scores, so ADR 0165 stands. They hold no record text,
person names, or Eve content, only that a step first happened and when.

They are the source of truth for First Value regardless of any analytics or
error-tracking provider. A provider may be adopted for error tracking and
product analytics under the hosted privacy decision, but it does not replace
these milestones and its data boundary is decided separately.

## Consequences

The hosted privacy policy must name the milestones as account data. Adding
content to them later changes a disclosed boundary, which is why the set is
closed rather than extensible.

The Newcomer Walkthrough remains a human observation; milestones confirm what
was seen, they do not substitute for watching a stranger try.

References: #565, ADR 0165, ADR 0226.
