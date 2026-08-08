# Household-Aware Eve and Proactive Behavior

**Status:** Accepted Wayfinder decision
**Decision ticket:** [Define household-aware Eve and proactive behavior](https://github.com/nick-neely/tendnote/issues/374)

## Decision summary

Phase Eight makes Tendnote usefully Household-aware without creating a shared
assistant persona, activity feed, collective task manager, or outbound household
messaging channel. Eve and the strategist remain private by default. A member may
deliberately enter a clearly labelled Household context, where Tendnote answers for
that caller from currently authorized shared coordination records and uses the
same domain-owned commands as the canonical product surfaces.

Each member may also opt into a small in-app **Household Check-in** in their
private daily or weekly briefing. It makes present shared coordination easier to
notice, but it is a personal, caller-specific delivery of canonical records—not a
shared digest, a report about other members, or a new source of truth.

## Contexts, callers, and capabilities

### Private by default

Ordinary Eve, Capture, strategist, scheduled workflows, and Review start in the
current member's private scope. Words such as “we,” a household name, or another
member's name do not change the scope or authorize a shared read. Private
relationship context, private Calendar connections, and member-owned evidence
remain private unless their domain's explicit sharing rule independently admits
them.

### Deliberate Household context

A member enters a Household context from the Household destination or an explicit
scope control in a supported Eve or Capture flow. The composer and results make
the boundary legible as **Household**, identify the current Household by name,
and describe it as visible only to the current member's authorized Household
records. The control is not a global mode, does not persist invisibly into a
later private conversation, and disappears immediately when membership ends.

The context may answer questions such as “What should we coordinate before the
trip?” or “What is coming up this week?” It may explain relationships among
already authorized records, but does not assert that any member owes work,
failed to act, or is next in a turn. A Responsibility Holder, when one exists,
is shown only as that record's factual, explicitly named field.

### Capability boundary

Every Household-aware capability receives an already-authorized, typed candidate
set. It obtains a current [Household Authorization Proof](../adr/0219-household-authorization-proofs-guard-cross-domain-collaboration.md)
for its caller, operation, and each record or bounded composition before reading,
ranking, generating, rendering, persisting, or delivering. The model, a prompt,
a UI toggle, a cached answer, or a prior successful result is never authority.

| Capability | May use for this caller | Must not use or imply |
|---|---|---|
| Household Eve and strategist | Authorized household-native Actions and Routines; household-native Saved Items whose bring-back timing is relevant; Event Plans; visible Gift Plans; and currently eligible shared Follow-Ups | Another member's private records, People graph, Memories, Source Records, restricted relationship context, or an inaccessible selected-member record |
| Household Calendar reasoning | Minimized, bounded summaries from a current Household Calendar Connection, labelled Calendar-derived and live or stale | Any member's private Calendar connection, raw provider payload, provider write/sync/RSVP, or a claim that cached data is current |
| Household Check-in | The same authorized candidate families, after deterministic eligibility and caps | Bare Assets or Asset Memories, Household Context as a coordination item, a relationship-history feed, inferred work, or a household-wide participation measure |
| Capture and Review | Explicit household intent through the owning domain; a shared proposal only when its evidence is already visible to its authorized audience | Scope inferred from conversational wording, a private-source hint, automatic sharing, or a shared durable record created by inference alone |

Household Context may orient an authorized Household conversation, but it never
becomes a task, ranking signal that overrides deterministic eligibility, or a
shared briefing card. An Asset contributes only through an independently
eligible linked Action or Routine. A shared Follow-Up may be read as existing
context when its ordinary timing makes it relevant, but only its owner may
change its lifecycle, timing, audience, or reminder.

Restricted content remains outside Orientation Context, Household composition,
ambient retrieval, strategic ranking, Check-ins, notification previews, and
proactive delivery. A direct, targeted request retains the already-decided
restricted-content boundary; it never causes that content to enter an ambient
Household output later.

## Grounding, freshness, and action

Eve and a Check-in return canonical record references, not generated household
truth. Each surfaced item gives the record's factual type, scope/provenance,
relevant timing, and a canonical link. Calendar-derived material identifies its
provider origin and whether it is live or stale. Generated prose is a short,
ephemeral explanation of why an authorized record is useful now; it is never
saved as Household context, activity history, or a briefing artifact.

An explicit request may invoke the same typed, domain-owned command available
from the canonical surface. The resulting confirmation names the target and
scope—for example, **Create for Household**—and preserves that domain's authority,
concurrency, evidence, and audit rules. A Check-in never performs a write merely
because it was generated. Its actions are canonical links or already-authorized,
explicit member actions; no universal “accept all,” generated assignment,
automatic Reminder Schedule, or external draft exists.

Inference remains review-first. An inferred household-native proposal may enter
shared Review only when its evidence is already safe for that audience and the
owning domain permits the proposal. A private inference remains private Review.
Review, not an Eve answer or a scheduled output, owns acceptance, editing,
dismissal, and durable creation.

## The Household Check-in

A Household Check-in is an optional, member-owned in-app briefing view. It helps
an active member notice a few time-sensitive, currently authorized coordination
items without converting shared visibility into personal obligation.

- It appears only after that member deliberately opts in to their private daily
  or weekly briefing; no member enables it for another member.
- Deterministic policy selects at most three eligible candidates for the
  briefing window before any model explanation or ordering. The model may
  summarize, connect, or explain only that bounded set; stable deterministic
  ordering is the fallback when generation is unavailable.
- It is available through a compact **Household check-in** entry from the
  member's private briefing/Today context and from Household. It is not a new
  third collection on the calm **Needs attention** / **Coming up** Household
  home, a persistent shared brief, or an activity feed.
- It is in-app only in Phase Eight. Tendnote adds no household email, shared
  channel, cross-member push, or general proactive notification. Existing
  Reminder Schedules remain per-record, per-member, and installation-scoped;
  they may alert only the member who chose them.
- If no current candidate is useful, Tendnote omits the entry rather than
  manufacturing an empty-state task. A member's private brief dismissal or
  snooze changes no household record and no other member's view.

### Seamless desktop and mobile behavior

The Check-in behaves as a focused, read-first view, not another dashboard. On
desktop, its compact entry sits with the Household context controls and opens a
single readable panel of one to three record rows. On mobile, the same labelled
entry appears in the normal single-column flow and opens a full, focused view;
it does not require a hover affordance, horizontal carousel, hidden gesture, or
secondary navigation concept.

Each row has a canonical link and gives its type, scope/provenance, timing, and
provider freshness in text—not color alone. Existing domain actions remain
visually and semantically subordinate to the link: consequential work opens the
canonical detail flow, while a small reversible action may use its established
domain control. Loading reserves the short list's shape; a failed family is
specific without hiding successful families or presenting an inaccurate global
empty state. Keyboard focus, screen-reader announcements, 200% text, reduced
motion, and reconciliation behavior follow the existing Household and Today
contracts.

## Schedules, failures, and revocation

The current private scheduled-workflow architecture remains member-scoped. A
scheduled Household Check-in resolves the active member, then re-authorizes the
candidate set at generation and again immediately before rendering or any
eligible record-specific reminder delivery. It never creates a Household-owned
schedule, expands a member's delivery target, or fans one member's alert out to
another member.

On departure, removal, audience or sensitivity change, Surprise Subject change,
provider disconnection, or lost credential, affected candidates, generated
output, cached views, pending Check-ins, deep links, and reminder eligibility
are invalidated. A stale or absent proof omits the record with the same neutral
treatment as absence; it never exposes a count, title, actor, timing, or reason.
One provider family may be explicitly unavailable or stale while other proven
families remain useful, but Tendnote never falls back to a private Calendar
connection or stale provider data as current truth.

## Implementation evidence and boundary

The implementation pass needs a focused Household-aware capability boundary that
accepts the caller, explicit context, requested operation, and authorized typed
candidates. It must keep deterministic eligibility/caps outside model prompts,
reuse domain-owned commands, propagate affected scopes, and recheck authorization
at every deferred boundary.

Its policy matrix and multi-member tests cover: private-default conversations;
authorized and unauthorized Household Eve; selected-audience and Surprise
Subject exclusions; restricted-content exclusion; Calendar live/stale/disconnected
states; source/provenance rendering; candidate caps and deterministic fallback;
explicit versus inferred writes; personal Check-in opt-in and no cross-member
delivery; departure/revocation races; and desktop/mobile accessibility states.

This decision neither implements a model mode, a scheduler, a notification
channel, nor a generic Household agent. Tables, route names, model prompts,
queue topology, and implementation slicing belong to the separate build-ticket
pass.
