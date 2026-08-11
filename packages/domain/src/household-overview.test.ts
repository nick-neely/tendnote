import { describe, expect, it } from "vitest";
import { buildHouseholdOverview } from "./household-overview";

const HOUSEHOLD = { id: "household-1", name: "The Neely house" };

const membership = (userId: string, overrides: Record<string, unknown> = {}) => ({
  userId,
  role: "member" as const,
  status: "active" as const,
  ...overrides,
});

const identity = (id: string, name: string | null, email: string) => ({ id, name, email });

describe("household overview", () => {
  it("leads with the viewer, then the rest of the household by name", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-b",
      household: HOUSEHOLD,
      memberships: [
        membership("user-c", { role: "member" }),
        membership("user-a", { role: "owner" }),
        membership("user-b", { role: "owner" }),
      ],
      identities: [
        identity("user-a", "Alex", "alex@example.com"),
        identity("user-b", "Mara", "mara@example.com"),
        identity("user-c", "Sam", "sam@example.com"),
      ],
    });

    expect(overview.name).toBe("The Neely house");
    expect(overview.householdId).toBe("household-1");
    expect(overview.viewerRole).toBe("owner");
    expect(overview.members.map((member) => member.name)).toEqual(["Mara", "Alex", "Sam"]);
    expect(overview.members[0]).toMatchObject({ isViewer: true, role: "owner" });
    expect(overview.members[1]).toMatchObject({ isViewer: false, role: "owner" });
  });

  it("describes a sole owner's household as one occupied seat", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [membership("user-a", { role: "owner" })],
      identities: [identity("user-a", "Alex", "alex@example.com")],
    });

    expect(overview.isSoleMember).toBe(true);
    expect(overview.seats).toEqual({ limit: 8, occupied: 1, remaining: 7, isFull: false });
  });

  /** Invited and removed memberships are not membership state the viewer may read here. */
  it("omits invited and removed memberships from both the list and the seat count", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [
        membership("user-a", { role: "owner" }),
        membership("user-b", { status: "invited" }),
        membership("user-c", { status: "removed" }),
      ],
      identities: [
        identity("user-a", "Alex", "alex@example.com"),
        identity("user-b", "Mara", "mara@example.com"),
        identity("user-c", "Sam", "sam@example.com"),
      ],
    });

    expect(overview.members.map((member) => member.userId)).toEqual(["user-a"]);
    expect(overview.seats.occupied).toBe(1);
  });

  it("counts live invitations against the household's capacity", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [membership("user-a", { role: "owner" })],
      identities: [identity("user-a", "Alex", "alex@example.com")],
      liveInvitations: 2,
    });

    expect(overview.seats).toMatchObject({ occupied: 3, remaining: 5 });
  });

  it("falls back to the address when a member has no display name", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [membership("user-a", { role: "owner" })],
      identities: [identity("user-a", "  ", "alex@example.com")],
    });

    expect(overview.members[0]).toMatchObject({ name: "alex@example.com" });
  });

  it("keeps the seat count honest when an identity read is incomplete", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [membership("user-a", { role: "owner" }), membership("user-b")],
      identities: [identity("user-a", "Alex", "alex@example.com")],
    });

    expect(overview.members).toHaveLength(1);
    expect(overview.seats.occupied).toBe(2);
    expect(overview.isSoleMember).toBe(false);
  });

  /**
   * The shipped reader cannot reach this: it locates the household through the
   * caller's own active membership and answers `null` first. The guard exists so
   * a caller that resolves a household some other way fails closed here instead
   * of describing membership state its viewer is not entitled to.
   */
  it("refuses to describe a household the caller is not an active member of", () => {
    expect(() =>
      buildHouseholdOverview({
        viewerUserId: "outsider",
        household: HOUSEHOLD,
        memberships: [membership("user-a", { role: "owner" })],
        identities: [identity("user-a", "Alex", "alex@example.com")],
      }),
    ).toThrow("Active household membership required.");
  });
});

const ALEX = identity("user-a", "Alex", "alex@example.com");
const MARA = identity("user-b", "Mara", "mara@example.com");

describe("household overview governance", () => {
  it("offers an owner the moves they hold over an ordinary member", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [membership("user-a", { role: "owner" }), membership("user-b")],
      identities: [ALEX, MARA],
    });

    const [viewer, other] = overview.members;
    expect(other).toMatchObject({
      promote: { available: true, blockedReason: null },
      remove: { available: true, blockedReason: null },
      awaitingOwnerReply: false,
    });
    // Nobody is handed a control pointed at themselves; their own moves are below.
    expect(viewer?.promote.available).toBe(false);
    expect(viewer?.remove.available).toBe(false);
  });

  /** The protected co-owner rule has to be legible where it is attempted. */
  it("explains, rather than hides, why another owner cannot be removed or promoted", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [
        membership("user-a", { role: "owner" }),
        membership("user-b", { role: "owner" }),
      ],
      identities: [ALEX, MARA],
    });

    const other = overview.members.find((member) => !member.isViewer);
    expect(other?.remove).toMatchObject({ available: false });
    expect(other?.remove.blockedReason).toMatch(/can't remove another owner/i);
    expect(other?.promote.blockedReason).toMatch(/already an owner/i);
  });

  it("gives a member no governance controls over anyone", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-b",
      household: HOUSEHOLD,
      memberships: [membership("user-a", { role: "owner" }), membership("user-b")],
      identities: [ALEX, MARA],
    });

    for (const member of overview.members) {
      expect(member.promote).toEqual({ available: false, blockedReason: null });
      expect(member.remove).toEqual({ available: false, blockedReason: null });
    }
    expect(overview.stepDown).toEqual({ available: false, blockedReason: null });
    // The one boundary a member is told about, because it is about their own
    // household rather than about another person.
    expect(overview.dissolution).toMatchObject({
      available: false,
      blockedReason: "Only an owner can end a household.",
    });
    // A member may always leave, and their departure ends nothing for anyone else.
    expect(overview.departure.available).toBe(true);
  });

  it("shows an outstanding offer to both sides without treating it as a role", () => {
    const asOwner = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [
        membership("user-a", { role: "owner" }),
        membership("user-b", { pendingRole: "owner", pendingRoleOfferedByUserId: "user-a" }),
      ],
      identities: [ALEX, MARA],
    });
    const offered = asOwner.members.find((member) => !member.isViewer);
    expect(offered).toMatchObject({ role: "member", awaitingOwnerReply: true });
    expect(offered?.promote.blockedReason).toMatch(/already been asked/i);
    expect(asOwner.ownerOffer).toBeNull();

    const asRecipient = buildHouseholdOverview({
      viewerUserId: "user-b",
      household: HOUSEHOLD,
      memberships: [
        membership("user-a", { role: "owner" }),
        membership("user-b", { pendingRole: "owner", pendingRoleOfferedByUserId: "user-a" }),
      ],
      identities: [ALEX, MARA],
    });
    expect(asRecipient.viewerRole).toBe("member");
    expect(asRecipient.ownerOffer).toEqual({ offeredByName: "Alex" });
  });

  it("holds the last owner back from leaving and names the way out", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [membership("user-a", { role: "owner" }), membership("user-b")],
      identities: [ALEX, MARA],
    });

    expect(overview.departure.available).toBe(false);
    expect(overview.departure.blockedReason).toMatch(/only owner/i);
    expect(overview.stepDown.available).toBe(false);
  });

  it("reports how far a two-owner dissolution has got", () => {
    const overview = buildHouseholdOverview({
      viewerUserId: "user-a",
      household: HOUSEHOLD,
      memberships: [
        membership("user-a", { role: "owner" }),
        membership("user-b", { role: "owner" }),
      ],
      identities: [ALEX, MARA],
      dissolutionConfirmations: ["user-a"],
    });

    expect(overview.dissolution).toMatchObject({
      available: true,
      required: 2,
      confirmed: 1,
      unanimous: false,
    });
    expect(overview.dissolution.awaitingUserIds).toEqual(["user-b"]);
    // With a co-owner present, both departure and stepping down are open again.
    expect(overview.departure.available).toBe(true);
    expect(overview.stepDown.available).toBe(true);
  });
});
