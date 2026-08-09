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
