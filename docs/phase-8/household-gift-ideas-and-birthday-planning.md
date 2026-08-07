# Household gift ideas and birthday planning with surprise privacy

Decision artifact for [Define household gift ideas and birthday planning with
surprise privacy](https://github.com/nick-neely/tendnote/issues/368). It defines
the focused Phase Eight collaboration contract for intentionally planning a gift
or birthday with selected Household Members. It does not implement Phase Eight,
turn Tendnote into a registry or shopping list, or generalize a recipient
exclusion into a broad visibility deny-list.

## A focused member-owned planning record

A **Gift Plan** is a member-owned planning record for one person and one
occasion. A birthday is the common occasion, but a plan may also be created for
an explicitly named celebration. Its owner may keep it private or deliberately
share it with selected active Household Members as co-planners. There is no
household-native Gift Plan and no household-wide gift-list form: a plan belongs
to the member who started it, not to the workspace.

A **Gift Idea** is an entry inside a Gift Plan rather than a free-standing
wishlist, inventory item, or future purchase record. This keeps the feature
about the finite act of planning a celebration. A plan is `active`,
`celebrated`, or `archived`; it has no task backlog, budget, retailer, cart,
fulfilment, delivery, or contribution accounting.

The plan contains only its deliberately entered, plan-facing subject name and
occasion snapshot. It may link to the underlying Person for its owner, but the
link never grants a co-planner access to that Person, their birthday, memories,
Assets, Source Records, or Follow-Ups. A co-planner can open a related record
only when they independently have access. The birthday remains a Person fact and
source truth; the plan neither edits nor replaces it.

## Surprise privacy is recipient exclusion

When the plan's subject is an active Household Member, the owner may mark them
as its **Surprise Subject**. That is a narrow, authoritative exclusion layered
on selected-member sharing:

- the owner explicitly selects the co-planner audience;
- the Surprise Subject is automatically excluded and cannot be added to that
  audience while the protection is active; and
- Tendnote suppresses the plan and every derived surface for that person:
  Household, Today, Eve, Capture, Review, Search, deep links, reminders,
  notifications, source references, counts, summaries, and history.

This is not a generic exclusion list. It exists only for the subject of a Gift
Plan who is currently a Household Member, and it does not change the visibility
model of any other record family. For a person outside the Household, selected
co-planners are sufficient; the plan remains a deliberately shared private
record rather than a whole-household announcement. The full boundary is
recorded in [ADR 0216](../adr/0216-surprise-subjects-are-authoritative-gift-plan-exclusions.md).

## Authority and lightweight coordination

The member who owns the plan alone may change its subject, occasion, selected
audience, Surprise Subject protection, or lifecycle, including archiving and
permanently deleting it. They are not a Household Owner by virtue of owning a
plan, and a Household Owner gets no extra plan authority.

Each selected co-planner may add Gift Ideas and discussion notes, and may edit
or remove only their own contributions. The plan records contributor and actor
provenance without rendering a Household activity feed.

To prevent duplicate gifts, a co-planner may make one reversible **self-claim**
on an idea: “I’ll handle this.” It identifies that member and time to the other
co-planners, and they may release their own claim. No one may claim an idea for
someone else. A claim does not assign work, create a reminder, track a purchase,
or measure participation.

## Creation, evidence, and assisted surfaces

The existing birthday-planning workflow remains private, grounded, and
review-only. When it recognizes an upcoming birthday, it may offer an immediate
**Start a gift plan** action with the visible person and birthday prefilled, but
it never creates or shares a plan, selects co-planners, chooses surprise
protection, claims an idea, creates an external draft, or sends anything.

Explicit Capture and Eve intent may create or update a plan only for a currently
authorized co-planner. Grounded gift ideas stay private suggestions in Review
until a co-planner explicitly adds one to a plan. Eve and Search return plans,
ideas, and source references only to their authorized audience; the Surprise
Subject receives no result or existence signal. Eve never infers collaborators,
persists an idea by itself, creates an external draft, or sends on a plan's
behalf.

## Household, Today, and reminders

An active, time-bound plan may compose into the capped Household **Coming up**
section for its authorized co-planners. It is a compact planning reference with
a canonical plan link, not a task or a prompt to contact someone. It may appear
in an authorized member's private Today only when the ordinary deterministic
Today policy finds it relevant; Household visibility never makes it personally
urgent.

Each authorized co-planner may choose one of their own Reminder Schedules for an
upcoming plan. This is an explicit personal opt-in: creating, sharing, claiming,
or being named in a plan never enrolls another person's device. The Surprise
Subject cannot receive a plan reminder. Membership and visibility are
revalidated before delivery, and lost access immediately cancels the member's
schedule and pending intent.

## Reconciliation and provenance

Plan and contribution edits use optimistic concurrency. A stale edit preserves
the member's draft, shows the current value and the relevant actor, and requires
them to revise or explicitly replace it. A self-claim is atomic: the first
current claim succeeds, while a concurrent claimant sees who claimed the idea
and may choose another. Tendnote never silently overwrites an idea or
double-claims it.

Current authorized co-planners may see quiet, plan-local provenance: creator,
contributor, last editor and time, self-claim/release, and plan-status changes.
It is not a broad Household feed, fairness record, score, or productivity
history. The Surprise Subject is excluded from it. Permanent deletion by the
member-owner removes the plan and its idea content rather than retaining a
hidden household archive.

## Departure, removal, and dissolution

If the plan owner leaves, is removed, or the Household dissolves, the plan stays
with that member but immediately becomes private. Collaborator access, claims,
Reminder Schedules, and pending reminder intents end. If a co-planner leaves or
is removed, their access, claim, and reminders end; ideas and notes they already
contributed remain in the owner's plan with their attribution unless they
removed them before departure. No plan is automatically widened, transferred,
or exposed to its subject as a membership relationship changes.

## Implementation boundary

The eventual implementation needs one owner-scoped Gift Plan query/mutation
layer that admits the caller before all reads and writes, applies the selected
audience plus Surprise Subject exclusion before composing any surface, enforces
contributor-scoped idea edits and atomic self-claims, and emits the plan-local
provenance described above. Web, Eve, Capture, Review, Search, Household, Today,
and reminders are thin adapters over that seam. The existing private,
review-only `birthday_gift_planning` artifact may offer plan creation but is not
itself a collaborative Gift Plan.
