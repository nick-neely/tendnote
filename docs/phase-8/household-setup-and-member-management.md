# Household setup and member management UX

Decision artifact for [Prototype household setup and member management](https://github.com/nick-neely/tendnote/issues/360). It turns the agreed activation and governance contracts into a user-facing handoff without implementing Phase Eight.

## Selected direction

Household management combines a people-first overview with stable, shallow
wayfinding. The household should feel like a small trusted circle, not an
administrative workspace: the household name and people lead, while roles,
capacity, and governance appear only where they explain an available or blocked
action.

The selected prototype combines the clearest parts of two explored structures:

- the household table's direct header, people list, invitation affordance, and
  optional Household Context prompt; and
- the guided structure's visible wayfinding, reduced to durable destinations
  instead of presenting every lifecycle moment as a navigation item.

A narrow contextual rail is useful only when its content is genuinely secondary
to the current page. It must not become the container for every management or
destructive action. Departure, recovery, and other consequential flows use the
main content area.

## Information architecture

**Account > Household** remains the product entry and return point. Product copy
uses **Household** for the section, the chosen household name for its heading,
and **Owner** or **Member** where role authority matters. Ordinary UI avoids the
more architectural phrase "Household Workspace."

An active household has exactly three durable destinations:

1. **Overview** — household identity, a people-first summary, occupied-seat
   context, the primary invitation affordance, and the optional first Household
   Context prompt.
2. **People & invitations** — complete active-member and live-invitation state,
   roles, capacity, resend/cancel controls, promotion or member-removal actions,
   and the explicit invitation form.
3. **Settings** — household naming, role and access boundaries, voluntary
   departure, recovery, and dissolution.

Desktop may present these destinations in a quiet local navigation rail. Narrow
screens replace the rail with a labelled section selector; this does not add a
persistent global Household destination.

Creation and invitation acceptance are transient entry flows, not durable
navigation destinations. A secure invitation link also does not expose the
active household's management navigation before acceptance.

## Overview contract

The overview leads with people rather than controls. It shows the household name,
the current member's role where useful, occupied capacity, active members, and
pending invitations permitted by the caller's role. **Invite someone** is the
single primary management action.

The optional prompt to "Add one thing everyone should know" may occupy a quiet
contextual rail on a wide overview. It is dismissible and never blocks activation.
On narrower layouts it follows the people summary in normal document flow.

The overview does not duplicate all settings, turn capacity into a progress goal,
show audit history, or imply that an Owner controls another member's private
records.

## People and invitation contract

Member rows put the person first, with email and current role as supporting
information. The current person is explicitly labelled. Pending invitations are
separate rows with their expiration state; they never masquerade as members.

Management actions stay contextual to the affected row or invitation. The
interface must make protected co-owner behavior legible at the attempted action:

- promoting a Member requires that person's acceptance;
- another Owner cannot be unilaterally demoted or removed;
- an Owner may step down only when another active Owner remains; and
- invitation creation and acceptance recheck the eight-seat policy.

The invitation form explains verified-address acceptance, the 14-day lifetime,
and the fact that a live invitation reserves a seat. Send, resend, and cancel are
explicit Owner actions.

## Departure, recovery, and dissolution

Consequential lifecycle actions never render in the overview's narrow contextual
rail. They open focused content within **Settings**, retaining a clear way back to
the Settings index.

The departure view states what ends immediately and what remains with the person.
A sole Owner sees the action disabled with the concrete recovery: another Member
must accept promotion before that Owner can leave. Returning always requires a
fresh invitation.

Recovery and dissolution remain distinct:

- an inaccessible Owner routes to a support-grade, evidence-based recovery path;
  there is no self-service authority bypass; and
- dissolution requires every active Owner's confirmation and explains the
  30-day household-native-record recovery window before permanent deletion.

The interface uses destructive styling only for the final consequential action,
not for explanatory copy, blocked states, or ordinary membership changes.

## Responsive and accessibility contract

- Preserve a people-first reading order and a single main column on phones.
- Do not rely on a cramped secondary rail below desktop widths; move contextual
  content into normal flow.
- Keep every lifecycle path reachable by labelled controls without swipe-only or
  precision gestures.
- Expose role, invitation, and blocked-action state in text rather than color
  alone.
- Keep focus visible, restore it to the invoking control after a focused flow,
  and announce invitation or membership state changes without stealing focus.
- At 200% text size, rows may stack their supporting actions but must not create
  horizontal page scrolling.

## Prototype evidence and implementation boundary

The prototype was reviewed against both the reference couple and a six-member
roommate household with one pending invitation. It exercised creation, overview,
invitation, acceptance, member management, Settings, departure, and recovery at
desktop and phone widths. The selected hybrid eliminated the overview sidebar's
action crowding while retaining direct navigation to protected lifecycle paths.

The complete exploration is preserved on the throwaway
[`prototype/phase-8-household-setup`](https://github.com/nick-neely/tendnote/tree/prototype/phase-8-household-setup)
branch. Variant D is the selected hybrid; variants A, B, and C preserve the
alternatives reviewed with the product owner. Run `pnpm dev:web`, then open
`/account?prototype=household&variant=D&scenario=couple&moment=overview`. The
prototype is planning evidence, not an implementation seed.

The implementation-ticket pass must reproduce this contract using production
data, owner-scoped product functions, invitation and governance policy,
accessibility tests, and the existing Tendnote design system.

No ADR is warranted. The selected information architecture and responsive
composition are bounded product-design choices that remain straightforward to
change; the hard-to-reverse governance decisions already live in
[Household Governance Protects Co-owners and Separates Invitations](../adr/0213-household-governance-protects-co-owners-and-separates-invitations.md).
