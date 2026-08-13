# Shared Household home and Today relationship

Decision artifact for [Define the shared Household home and Today relationship](https://github.com/nick-neely/tendnote/issues/364).
It defines the durable shared coordination surface that later Phase Eight domains
may compose without replacing a member's private Today or turning Account
management into a working dashboard.

## Product topology

Phase Eight has three deliberately separate destinations:

- **Today** answers **What is relevant to me now?** It remains the current
  member's capped, private, cross-domain home shortlist.
- **Household** answers **What are we jointly coordinating?** It is a durable
  global destination for active Household Members and a shared read over
  authoritative household-visible records.
- **Account > Household** owns who belongs to the workspace and how it is
  governed, including invitations, Household Context, roles, departure,
  recovery, and dissolution.

Household management therefore remains Account-local as previously decided.
The global Household destination is a later working surface, not a relocation
or duplication of the Household Overview.

## Activation and navigation

Membership alone does not ship an empty global destination before Tendnote has
a supported shared coordination domain. The global **Household** destination
launches with the first such domain. From then on, every active Household Member
sees it, including when their current authorized composition is empty.

The global navigation label is **Household**. The page leads with the chosen
household name so navigation remains compact without hiding which household the
member is viewing. Desktop places Household alongside the existing primary
destinations; mobile exposes the same labelled destination through the existing
compact navigation. A secondary **Manage household** link returns to Account.

Departure or removal immediately removes the destination. The former member
returns to their private Today or Account with a neutral explanation that access
ended. Dissolution removes the destination and routes eligible Owners to the
existing recovery state.

## Home composition

The Household home is a calm coordination view, not a dashboard framework. It
has two primary sections:

1. **Ready now** — household-visible records that can be acted on now, without
   implying urgency, fault, or a collective backlog.
2. **Coming up** — time-bound household-visible records approaching soon.

Each section normally shows three records and never more than five. When a
domain has more eligible records, a labelled domain link exposes the remainder.
Below the two sections, compact entry links may lead to supported shared domain
surfaces. Tendnote does not introduce configurable widgets, a collective
"Household Today," an activity stream, member-status panels, or a second task
backlog.

Only authoritative records intentionally visible to the current member qualify.
Suggested records remain in Review until accepted. Household Context may orient
Eve and remains manageable in Account, but it does not become coordination-feed
content.

Eligibility, grouping, caps, ordering, and stable fallback are deterministic.
The shared composition is common to members with the same record access. A
member's **Not today** choice changes only that member's private Today; it never
hides or reorders a record on the Household home. Selected-member visibility may
legitimately produce a different authorized composition without presenting the
record as household-wide truth.

## Ownership, provenance, and authority

The home preserves each domain's ownership and collaboration model:

- household-native records use a quiet **Household** scope label;
- member-owned records deliberately shared to the household may say **Shared by
  Mara**; and
- a person is labelled responsible only when that domain has an explicit
  responsibility or assignment concept.

Creation, sharing, editing, completion, archiving, responsibility, assignment,
conflicts, notifications, surprise privacy, departure, and dissolution remain
owned by the record's domain. Tendnote never infers responsibility from who
created, shared, or last edited a record, and provenance does not become an
avatar-heavy activity feed.

The home is read-first. It may expose only small, reversible actions already
authorized by the record's domain, such as completing an eligible shared Action.
Every inline mutation calls the same product function as the canonical domain
surface and reconciles to authoritative state. Unclear or consequential actions
link to record detail instead of inventing a universal household control.

## Today relationship

A household-visible record may also appear in a member's Today when the existing
owner-scoped deterministic Today policy finds it eligible and relevant to that
member. Household visibility alone does not make a record personally urgent,
and appearing in Today does not change the shared record's ownership, authority,
or Household-home position.

Today remains individually curated and may use bounded ephemeral Eve ranking
inside its deterministic policy. The Household home does not personalize order
per member or use opaque generated priority. A later domain may earn bounded
agent ranking only behind explicit deterministic eligibility, caps, explanation,
and stable fallback.

## Eve, Capture, Review, and Search

Eve may answer questions about records visible to the current member and link to
the Household home or a canonical record. Explicit Capture may create a
household-visible record only through that domain's approved audience and
authority contract. Search returns typed, permission-filtered records with
canonical links.

Suggested records stay in Review and do not become established Household-home
content before acceptance. Generated summaries are ephemeral explanation, never
persisted shared state, hidden lifecycle authority, or a substitute for the
underlying records.

## Empty, loading, and failure states

After the destination has launched, an empty authorized composition explains
that intentionally shared reminders, plans, events, and other supported records
will appear here. It offers only creation paths whose domains already have a
shared contract. It does not lead with invitations, generic **Add item**, setup
progress, empty widgets, or a blank activity feed.

Navigation and the household name render only inside a currently admitted
Household frame. **Ready now** and **Coming up** stream independently with
truthful shaped reserves. One failed domain family does not erase successful
families or produce a misleading global empty state.

The surface is online-required. It never substitutes cached shared data after
authorization becomes uncertain. Membership changes fail closed. A conflicting
or revoked mutation preserves local intent where safe, explains that the record
changed or access ended, and reconciles to authoritative state.

## Responsive and accessibility contract

Phones retain the same single-column order: **Ready now**, **Coming up**,
then supported domain links. The surface does not collapse into a horizontal
dashboard grid, carousel, or sidebar.

Sections and record collections use semantic headings and lists. Record type,
scope, timing, and state appear in text rather than color alone. Every card has a
canonical link and every action supports keyboard operation with visible focus.
Status changes announce without stealing focus; dialogs and inline actions
restore focus; reconciliation respects reduced motion; and 200% text does not
cause horizontal page scrolling. There is no drag-only ranking, swipe-only
action, hover-only provenance, masonry layout, or auto-advancing content.

## Implementation boundary

This decision specifies the shared surface shell and composition contract. It
does not decide the collaboration authority of reminders, gifts, events, or any
other Personal OS domain. Those later decisions must define their supported
ownership forms, member authority, responsibility, conflicts, notification
eligibility, restricted visibility, and lifecycle behavior before their records
can safely compose into Household.

No new glossary entry or ADR is warranted. **Today**, **Household Workspace**,
visibility scope, and record ownership already have precise domain meanings. The
new global destination is a reversible product and information-architecture
choice; the hard-to-reverse Today and Household boundaries remain governed by
the existing domain model and ADRs.
