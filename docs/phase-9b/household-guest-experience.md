# The Household Guest experience

Prototype artifact for [Prototype the Household Guest
experience](https://github.com/nick-neely/tendnote/issues/577). **Status:
decided.** The owner reviewed three structurally different variants and chose
the read-only library, with four rulings recorded below. Visual design,
theming, and final wording are not settled here; the prototype's look and copy
bind nothing.

The prototype is one self-contained file:
[`prototypes/household-guest-experience.html`](prototypes/household-guest-experience.html).
Open it in a browser. `?variant=A|B|C` or the arrow keys switch variants, the
left column is the account and household state, and the scenario panel and
guided walkthroughs drive entry, browsing, a refusal, subscribing, the
household losing and regaining its last paying Owner, and removal. The fixture
holds nineteen readable records across the eight read-set domains plus three
records that must never reach the guest.

## What the prototype builds on

It takes as given the Household Guest section of the
[paid-access lifecycle](subscription-ownership-and-paid-access-lifecycle.md)
(the read set, no inference, no expiry, the live sponsor check, removal through
the existing member flow), the pending area and billing notices from
[signup through First Value](self-service-signup-through-first-value.md), and
the one plan from [the paid offer and price](paid-offer-and-price.md).

## The variants

| Variant | Shape | Resemblance to the product | Verdict |
| --- | --- | --- | --- |
| A - Household digest | One column, upcoming then standing, records expand inline, no navigation | Least | Rejected: one scroll does not hold eight domains at real household volume |
| B - Read-only library | Persistent read-only band, domain tabs with counts, list and detail pane | Medium, its own chrome | **Chosen** |
| C - Shell preview | Mirrors the real sidebar with paid-only destinations shown as locked entries | Most | Rejected: it is the Authenticated App Shell with locks, which the lifecycle decision ruled out, and it turns a courtesy view into a sales surface |

## The decided experience

1. **Entry.** Accepting the Household Invitation lands the guest on a single
   orientation screen, shown once: whose household this is, that the view is
   read-only, what they can see, and what they cannot. Then the library.
2. **The surface** is a read-only library with its own chrome, not the
   Authenticated App Shell. A persistent band states that the account is a
   guest of the named household and that the records belong to its members.
3. **Navigation** is one tab per read-set domain, each with a count: People,
   Memories, Follow-Ups, General Actions, Assets, Gift Plans, Household
   Context, Household Calendar Events. A domain with nothing readable shows
   zero rather than disappearing. Each tab is a list and a detail pane.
4. **Record detail** states provenance: whom the record belongs to, why the
   guest can see it (household-native, household-scope, or shared-scope
   addressed to them), its date, and that the guest's right is read.
5. **Paid features are absent, not locked.** The prototype's four dead buttons
   (Edit, Remind me, Ask Eve about this, Export) are removed. Nothing in the
   library advertises Eve, capture, reminders, exports, or provider
   connections. Withheld records are never rendered, counted, or hinted at; a
   Gift Plan where the guest is not a co-planner does not exist for them.
6. **The subscribe path is one link in the band** and nowhere else. It leads to
   the ordinary plan choice and Checkout. On the projected paid invoice the
   account becomes Paid, keeps its household membership, and enters the full
   product with the ordinary first-run prompt.

## The not-admitted states

The pending area stays the single home for every signed-in, not-admitted,
not-Lapsed state. This decision **revises its action set**: the actions shown
depend on what the account owns, rather than being a fixed four. An account
with nothing of its own to export is not offered Export. Delete and Sign out
are always present, so the exit is never blocked.

| State | One line of what happened | Actions |
| --- | --- | --- |
| Household lost its last paying Owner | "This household is not currently active on Tendnote." Nothing was deleted, the membership is unchanged, and the view returns if that changes. | Subscribe, Delete, Sign out |
| An Owner removed the guest | The membership in the household ended. No household data is shown. | Subscribe, Delete, Sign out |

**Name nobody.** The sponsor-lapsed message names no Owner, gives no billing
detail, promises no date, and asks the guest to chase no one. The guest already
knows who their Owners are; whose payment stopped is the billing detail the
lifecycle decision keeps private. The only call to action is the guest's own.

The sponsor check is live, so the collapse and the return both happen on the
next request with no notification in either direction.

## What carries into the specification

- **The guest library contract:** own chrome, persistent read-only band with
  the sole subscribe link, domain tabs with counts over the guest read set,
  list and detail with stated provenance, one-time orientation on entry.
- **Absent, not locked:** no paid affordance is rendered for a guest, and no
  withheld record is rendered, counted, or implied.
- **The revised pending-area contract:** one home, one line of what happened,
  actions by what the account owns, Delete and Sign out always present. This
  supersedes the fixed four-action list in
  [signup through First Value](self-service-signup-through-first-value.md).
- **The two guest pending states** and the name-nobody rule above.
- A subscribing guest keeps the membership and gets the ordinary first run.

The prototype stays on this branch as the primary source, including the two
rejected variants and the dead buttons the owner removed. Its fixture's
withheld-record cases are the liftable part for authorization tests; the page
around them is throwaway.
