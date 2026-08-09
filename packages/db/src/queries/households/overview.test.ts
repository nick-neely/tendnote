import { describe, expect, it } from "vitest";
import { createInMemoryHouseholdInvitationStore } from "./in-memory-invitation-store";
import { createInMemoryHouseholdStore } from "./in-memory-store";
import { createHouseholdInvitationLifecycle } from "./invitations";
import { createHouseholdLifecycle } from "./lifecycle";
import { createHouseholdOverviewReader, type HouseholdIdentityStore } from "./overview";

const IDENTITIES = [
  { id: "owner-user", name: "Alex", email: "alex@example.com" },
  { id: "member-user", name: "Sam", email: "sam@example.com" },
  { id: "outsider-user", name: "Jo", email: "jo@example.com" },
];

function identityStore(): HouseholdIdentityStore {
  return {
    async listUserIdentities({ userIds }) {
      return IDENTITIES.filter((identity) => userIds.includes(identity.id));
    },
  };
}

function setup() {
  const store = createInMemoryHouseholdStore();
  return {
    lifecycle: createHouseholdLifecycle(store),
    getHouseholdOverviewForUser: createHouseholdOverviewReader(store, identityStore()),
  };
}

describe("household overview read", () => {
  it("has nothing to describe before a household exists", async () => {
    const { getHouseholdOverviewForUser } = setup();

    expect(await getHouseholdOverviewForUser({ userId: "owner-user" })).toBeNull();
  });

  it("describes the creator as the household's sole active owner", async () => {
    const { lifecycle, getHouseholdOverviewForUser } = setup();
    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "The Neely house",
    });

    expect(await getHouseholdOverviewForUser({ userId: "owner-user" })).toEqual({
      householdId: household.id,
      name: "The Neely house",
      viewerRole: "owner",
      isSoleMember: true,
      // No invitation reader is wired here, so the overview describes people only.
      invitations: [],
      seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
      members: [
        {
          userId: "owner-user",
          name: "Alex",
          email: "alex@example.com",
          role: "owner",
          isViewer: true,
          awaitingOwnerReply: false,
          // Nobody is handed a governance control pointed at themselves.
          promote: { available: false, blockedReason: null },
          remove: { available: false, blockedReason: null },
        },
      ],
      ownerOffer: null,
      // A household of one has only one exit, and it is not the door marked leave.
      departure: {
        available: false,
        blockedReason:
          "You're the only person here, so there's nobody to hand the household to. Ending it is how you close it.",
      },
      stepDown: {
        available: false,
        blockedReason:
          "You're the only owner. Someone else here needs to accept co-ownership first.",
      },
      dissolution: {
        available: true,
        blockedReason: null,
        required: 1,
        confirmed: 0,
        awaitingUserIds: ["owner-user"],
        unanimous: false,
        viewerHasConfirmed: false,
      },
    });
  });

  it("keeps an invited-but-not-joined person out of the authorized membership state", async () => {
    const { lifecycle, getHouseholdOverviewForUser } = setup();
    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "The Neely house",
    });
    await lifecycle.inviteMember({
      ownerUserId: "owner-user",
      householdId: household.id,
      invitedUserId: "member-user",
    });

    const overview = await getHouseholdOverviewForUser({ userId: "owner-user" });

    expect(overview?.members.map((member) => member.userId)).toEqual(["owner-user"]);
    expect(overview?.seats.occupied).toBe(1);
    expect(await getHouseholdOverviewForUser({ userId: "member-user" })).toBeNull();
  });

  it("shows each member their own role in the same household", async () => {
    const { lifecycle, getHouseholdOverviewForUser } = setup();
    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "The Neely house",
    });
    await lifecycle.inviteMember({
      ownerUserId: "owner-user",
      householdId: household.id,
      invitedUserId: "member-user",
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: "member-user" });

    const ownerView = await getHouseholdOverviewForUser({ userId: "owner-user" });
    const memberView = await getHouseholdOverviewForUser({ userId: "member-user" });

    expect(ownerView?.viewerRole).toBe("owner");
    expect(memberView?.viewerRole).toBe("member");
    expect(memberView?.members.map((member) => member.name)).toEqual(["Sam", "Alex"]);
    expect(memberView?.isSoleMember).toBe(false);
    expect(memberView?.seats.occupied).toBe(2);
  });

  it("tells a user outside every household nothing about the ones that exist", async () => {
    const { lifecycle, getHouseholdOverviewForUser } = setup();
    await lifecycle.createHousehold({ ownerUserId: "owner-user", name: "The Neely house" });

    expect(await getHouseholdOverviewForUser({ userId: "outsider-user" })).toBeNull();
  });

  /**
   * A live invitation holds a seat without being a membership (ADR 0213), so the
   * two halves of the overview must disagree by design: everyone sees the seat
   * it occupies, only the Owner sees the address it went to.
   */
  it("charges a live invitation a seat for everyone but shows the address only to the owner", async () => {
    const store = createInMemoryHouseholdStore();
    const lifecycle = createHouseholdLifecycle(store);
    const invitationStore = createInMemoryHouseholdInvitationStore({
      households: store,
      identities: IDENTITIES,
    });
    const invitations = createHouseholdInvitationLifecycle(invitationStore);
    const getHouseholdOverviewForUser = createHouseholdOverviewReader(
      store,
      identityStore(),
      invitations,
    );

    const { household } = await lifecycle.createHousehold({
      ownerUserId: "owner-user",
      name: "The Neely house",
    });
    await lifecycle.inviteMember({
      ownerUserId: "owner-user",
      householdId: household.id,
      invitedUserId: "member-user",
    });
    await lifecycle.acceptInvite({ householdId: household.id, userId: "member-user" });
    await invitations.sendInvitation({ ownerUserId: "owner-user", email: "jo@example.com" });

    const ownerView = await getHouseholdOverviewForUser({ userId: "owner-user" });
    const memberView = await getHouseholdOverviewForUser({ userId: "member-user" });

    expect(ownerView?.seats.occupied).toBe(3);
    expect(ownerView?.invitations.map((invitation) => invitation.email)).toEqual([
      "jo@example.com",
    ]);

    expect(memberView?.seats.occupied).toBe(3);
    expect(memberView?.invitations).toEqual([]);
    expect(memberView?.members.map((member) => member.name)).toEqual(["Sam", "Alex"]);
  });
});
