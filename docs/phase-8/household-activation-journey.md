# Household activation journey

Decision artifact for [Define the Phase Eight household activation journey](https://github.com/nick-neely/tendnote/issues/356). It makes the existing Household Workspace, invitation, and Context Fact foundations usable without deciding the later shared-home, Today-navigation, or cross-domain collaboration contracts.

## Entry and return point

Account owns the durable **Household** entry and management area. A signed-in user
with no active Household Workspace sees a short explanation and can start
creation. An active Household Member returns there to see the Household Overview
and manage the household as their role allows. Eve may direct a user to that area
when asked, but it must not create a workspace, create an invitation, or send an
invitation.

A Household Invitation URL is the other entry path. It is a secure, capability
specific route, not a general discovery or workspace-switching surface.

## Create a household

1. A user supplies a household name.
2. Creating it immediately produces an active Household Workspace and an active
   sole-Owner membership for the creator. It is usable even when the creator
   chooses **Invite someone** later.
3. The next step offers an optional, explicit invitation. Choosing **Not now**
   lands on the Household Overview; it does not create a placeholder membership
   or change the household's active state.

The lifecycle, eight-seat policy, invitation authority, and co-owner protection
remain those defined by [Household Governance Protects Co-owners and Separates
Invitations](../adr/0213-household-governance-protects-co-owners-and-separates-invitations.md).

## Accept an invitation

The invitation route initially exposes only a generic invitation state. It asks a
signed-out recipient to sign in or create an account, then requires the invited
verified email address. Once that condition is satisfied, Tendnote identifies the
named Household Workspace and requires an explicit **Join** confirmation before
consuming the single-use capability and creating the active membership.

If the signed-in account uses a different verified address, Tendnote asks the
user to sign in with the invited address without revealing whether that address
has an account. If that user already has an active Household Workspace, Tendnote
explains the conflict privately and does not switch, leave, or otherwise alter
either workspace. Expired, declined, cancelled, or consumed capabilities render
a neutral terminal state. These states must not disclose an account, admission,
or other-workspace fact to an unauthenticated visitor.

## First active experience

After creation or acceptance, the member arrives at the Account-based **Household
Overview**. It is a calm activation and return surface, not the future shared
household home or planning dashboard. It shows only the member's authorized
household state:

- the workspace name and their member or owner role;
- active members and pending invitations where their role permits;
- role-appropriate actions such as invite, resend/cancel, leave, or member
  management; and
- an optional, skippable prompt to establish one useful Household Context fact,
  such as a location or durable shared preference.

The prompt makes the shared layer useful without treating Context Facts as a
setup requirement, a household biography, or a substitute for later Personal OS
domains. Existing active-member authority governs every Household Context change;
the overview does not turn an Owner into the arbiter of household truth.

## Scope boundary

This decision intentionally supplies a secure entry flow and Account return
point only. It does not add a persistent top-level Household destination, define
the relationship to Today, specify the eventual household planning surface, or
define cross-domain collaboration and notification behavior. Those remain later
map decisions.

## Acceptance examples

- Alex, who has no active household, names one and chooses **Not now**. Alex is
  immediately its sole active Owner and can return to Account > Household.
- Alex explicitly invites Sam. Sam opens the link, signs in with the invited
  verified address, reviews the named household, and explicitly joins. Sam then
  reaches the same Household Overview as an active Member.
- Sam is already active in another household. Tendnote explains that private
  conflict after authentication; it neither consumes the invitation nor moves
  Sam between households.
- An old link is opened after cancellation or expiry. The page provides a neutral
  terminal result and no membership or account detail.
