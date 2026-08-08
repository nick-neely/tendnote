# Household privacy, recovery, and isolation evidence

Decision artifact for [Define cross-domain household privacy and recovery
evidence](https://github.com/nick-neely/tendnote/issues/373). It establishes the
cross-domain contract that applies after a supported Personal OS domain has
defined its own ownership, visibility, authority, and lifecycle behavior. It
does not add a generic permission system, loosen a domain contract, implement
Phase Eight, or create its implementation backlog.

## The Household Authorization Proof

Every Household-capable operation obtains a **Household Authorization Proof**
from the authoritative domain boundary before it reads, reveals, changes,
queues, or delivers anything. The proof is about one caller, operation, and
record or bounded composition at the time it is used. It evaluates at least:

- current authenticated caller and active Household Membership;
- requested operation rather than a broad role or view permission;
- ownership form and the domain's mutation-authority rule;
- current selected-member or whole-Household audience;
- lifecycle state, sensitivity, source-evidence authorization, and parent/child
  visibility ceilings where applicable; and
- domain-local constraints, including a Gift Plan's Surprise Subject exclusion,
  a Household Calendar Connection's owner-governed configuration, and a
  provider record's live/stale eligibility.

The proof is a domain result, not a shared table that flattens unlike records.
Domain boundaries may reuse shared membership, scope, affected-scope, and
provenance helpers, but they must retain their own authority and evidence rules.
A Household Owner may govern invitations and connections without gaining access
to another member's private record; a record's visibility never transfers its
owner's authority.

No adapter is an authorization boundary. Web routes and Server Actions, Eve,
Capture, Review, Search, Today, Household, reminder dispatch, provider readers,
and deep links call the same typed domain boundary. A model prompt, UI state,
client-supplied household id, cached result, prior page render, or a role check
without the record policy never substitutes for a proof.

## Opaque failure and composition

If the proof is absent, stale, or uncertain, Tendnote fails closed. It returns
the same neutral unavailable/not-found treatment for an unauthorized record as
for a record that is absent or no longer eligible. It reveals no title, preview,
actor, count, timestamp, error distinction, redirect target, or explanation
that would disclose protected existence.

This applies to individual records and to all derived surfaces:

- Household, Today, Review, and result lists omit an inaccessible candidate
  rather than preserving a placeholder or count.
- Eve and Capture receive only already-authorized, typed record references and
  minimized grounding. They never receive another member's private context or a
  prompt-side hint that such context exists.
- Search, semantic retrieval, exact recall, summaries, and rankers filter by
  proof before ranking or generation. Semantic similarity cannot broaden the
  candidate set.
- Deep links resolve authorization before choosing a target. A revoked link does
  not redirect through a page that can expose prior title or layout metadata.
- A visible parent, selected audience, shared provider event, or Household home
  row never authorizes an independently scoped child, source record, evidence,
  linked Person, or related private record.

Mixed-authority compositions may show only independently proven families. A
provider or cache failure in one family remains explicit and fail-soft for that
family, but it never falls back to a member's private provider connection or
uses stale data as current truth.

## Revocation, caches, and deferred work

Access-changing events have immediate revocation semantics: member departure or
removal, Household Dissolution, ownership or audience changes, Surprise Subject
creation or change, sensitivity/lifecycle changes, provider disconnection, and
loss of an active credential or membership all invalidate affected authority.

The originating mutation returns affected viewer and household scopes. Those
scopes invalidate relevant server and client read models, composition tags,
deep-link lookups, scheduled intents, and provider caches. Invalidation shortens
the window for stale data; it does not itself grant or preserve access.

Every deferred operation proves authority again at the last safe point:

- a streamed region proves before it serializes a result;
- a cache refill proves before it writes or returns a viewer-scoped model;
- a deep link proves before it selects a route;
- a background job proves before loading protected content and again before any
  durable action it makes;
- reminder dispatch proves current subscription, membership, visibility,
  occurrence, installation opt-in, and preview policy immediately before each
  delivery; and
- a provider reader proves the current Household Calendar Connection and
  membership before returning any minimized provider summary.

An in-flight operation that loses proof stops. It neither emits an alert nor
uses the previous state to finish a Household mutation. A stale collaborative
write continues to use each domain's optimistic-reconciliation contract; it
does not silently retry against a changed audience or membership.

## Minimized audit, retention, and recovery

Consequential Household actions retain a two-year, authorized-only audit entry
with no record content. The entry records the actor (or a scrubbed system actor),
time, operation, target kind and identifier, ownership form where relevant,
policy/version marker, and outcome. It covers at least Household lifecycle and
recovery decisions, membership/role/audience changes, workspace-native writes
and archive/restore, sensitive or restricted audience confirmations, invitation
delivery state, provider-connection changes, and policy-relevant failed
authorization outcomes.

Audit entries exclude invitation capabilities and URLs, message bodies, raw
provider payloads, source evidence, secrets, record values, generated prose,
and device subscription endpoints. They support authorized support and
recovery review without becoming a Household activity feed or a second content
store.

Short-lived, scrubbed security telemetry separately records rate limits,
replay/token failures, malformed requests, and unusual denied-access patterns.
It is minimized, access-restricted, and may never be rendered to other Household
Members or used to infer private activity. It supports abuse prevention and
operational investigation rather than product history.

Household Dissolution immediately ends member access and delivery. It places
household-native records, authorized evidence, and their current authoritative
state into the established 30-day recovery set; it never moves member-owned
private records or their evidence there. Recovery restores the household state
as a whole and requires its existing authorized recovery path. At permanent
deletion, content and provider-cache material are removed; only the approved
minimized non-content audit tombstone remains for the two-year audit period.

## Abuse and misconfiguration safeguards

- Treat invitation delivery as explicit Owner action under the existing
  non-enumerating, single-use, rate-limited capability contract; never use an
  invitation state to reveal account, admission, or other-Household facts.
- Make shared-provider designation explicit and owner-governed. A failed,
  revoked, or ambiguous Household Calendar Connection cannot fall back to a
  credential holder's private Calendar connection.
- Apply quotas and rate limits at the relevant actor, Household, capability,
  and delivery boundary. Rate limiting denies or delays work without disclosing
  which protected record motivated it.
- Keep external sends and external draft creation behind their existing explicit
  approval boundaries. Household authorization is never approval to send.
- Preserve quiet factual provenance for permitted collaborative work, but never
  expose audit history, denied attempts, security telemetry, or member activity
  as a feed, score, participation ledger, or fairness measure.

## Required implementation-slicing evidence

Each Phase Eight implementation slice supplies a compact policy matrix that
names its ownership forms, authorized actors and operations, visibility and
evidence rules, sensitivity treatment, derived surfaces, revocation triggers,
and audit events. The matrix is the test oracle, not documentation after the
fact.

Automated tests use at least two active members plus a removed member or
excluded recipient where relevant. They prove the allowed path and prove that an
unauthorized caller receives no content, count, explanation, deep-link target,
cache result, queued delivery, or existence signal. The cases cover direct
domain reads and writes as well as every implicated adapter: web, Eve, Capture,
Review, Search, Today, Household, reminders, provider reads, cache revalidation,
background work, and deep links.

Race tests cover membership or audience revocation between candidate selection
and serialization, dispatch, delivery, or mutation commit. Provider and cache
tests prove that private or stale fallback cannot cross the Household boundary.
Contract tests exercise the typed authorization boundary directly; adapter tests
demonstrate that no route bypasses it. New model evaluations supplement but do
not replace deterministic isolation tests.

## Implementation boundary

This decision extends the existing owner-scoped policy and affected-scope rails
into a cross-domain Household authorization-and-revocation requirement. It does
not prescribe tables, cache technology, retention-job mechanics, a generic ACL,
or an implementation order. The separate implementation-ticket pass chooses
those seams while preserving this contract and
[Household Authorization Proofs Guard Cross-Domain Collaboration](../adr/0219-household-authorization-proofs-guard-cross-domain-collaboration.md).
