import { describe, expect, it, vi } from "vitest";
import {
  createAdmissionResolver,
  createLocalAdmissionReader,
  type GuestHousehold,
} from "./admission";
import { createInMemoryAccessProfileStore } from "./in-memory-store";
import { createAccessProfileQueries } from "./queries";

const OWNER = { userId: "owner-1", email: "Owner@Example.com", emailVerified: true };
const OTHER = { userId: "other-1", email: "other@example.com" };

describe("shared admission resolver", () => {
  it("durably admits only the configured self-hosted owner", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    const evaluateFlag = vi.fn().mockResolvedValue(true);
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag,
      policy: {
        mode: "self-hosted",
        valid: true,
        bootstrapOwnerEmail: "owner@example.com",
      },
    });

    const ownerDecision = await resolver.resolveAccess(OWNER);
    const otherDecision = await resolver.resolveAccess(OTHER);

    expect(ownerDecision).toMatchObject({
      admitted: true,
      profile: { userId: OWNER.userId, source: "self_hosted_bootstrap" },
    });
    expect(otherDecision).toMatchObject({ admitted: false, status: "pending" });
    expect(evaluateFlag).not.toHaveBeenCalled();
    await expect(queries.listAdmittedOwnerUserIds()).resolves.toEqual([OWNER.userId]);
  });

  it("withholds the self-hosted owner role from an unverified matching session", async () => {
    // An attacker who registers the configured owner email via public credential
    // signup receives a session, but Better Auth marks it emailVerified=false. The
    // email matches the bootstrap owner, yet the durable owner role must not be
    // granted until ownership is verified.
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    const evaluateFlag = vi.fn().mockResolvedValue(true);
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag,
      policy: { mode: "self-hosted", valid: true, bootstrapOwnerEmail: "owner@example.com" },
    });

    const unverified = await resolver.resolveAccess({ ...OWNER, emailVerified: false });

    expect(unverified).toMatchObject({ admitted: false, status: "pending" });
    // No self_hosted_bootstrap grant was persisted, so the singleton stays open
    // for the real owner to claim once verified.
    await expect(queries.listAdmittedOwnerUserIds()).resolves.toEqual([]);
    expect(evaluateFlag).not.toHaveBeenCalled();

    // The same session becomes the owner the instant its email is verified.
    const verified = await resolver.resolveAccess({ ...OWNER, emailVerified: true });
    expect(verified).toMatchObject({
      admitted: true,
      profile: { userId: OWNER.userId, source: "self_hosted_bootstrap" },
    });
    await expect(queries.listAdmittedOwnerUserIds()).resolves.toEqual([OWNER.userId]);
  });

  it("treats a missing emailVerified flag as unverified and fails closed", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag: vi.fn().mockResolvedValue(true),
      policy: { mode: "self-hosted", valid: true, bootstrapOwnerEmail: "owner@example.com" },
    });

    const decision = await resolver.resolveAccess({ userId: OWNER.userId, email: OWNER.email });

    expect(decision).toMatchObject({ admitted: false, status: "pending" });
    await expect(queries.listAdmittedOwnerUserIds()).resolves.toEqual([]);
  });

  it("fails closed for invalid configuration and reports only a safe diagnostic", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    await queries.grantAccess({ userId: OWNER.userId, source: "manual_grant" });
    const evaluateFlag = vi.fn().mockResolvedValue(true);
    const report = vi.fn();
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag,
      policy: {
        mode: "invalid",
        valid: false,
        diagnostic: { code: "missing_bootstrap_owner_email" },
      },
      reportConfiguration: report,
    });

    const decision = await resolver.resolveAccess(OWNER);

    expect(decision).toMatchObject({ admitted: false, status: "pending" });
    expect(decision.profile).toBeNull();
    expect(evaluateFlag).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith({ code: "missing_bootstrap_owner_email" });
  });

  it("retains hosted flag behavior and persists the flag decision", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    await queries.ensureAccessProfile({ userId: OTHER.userId });
    const evaluateFlag = vi.fn().mockResolvedValue(true);
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag,
      policy: { mode: "hosted", valid: true },
    });

    const decision = await resolver.resolveAccess(OTHER);

    expect(decision).toMatchObject({ admitted: true, profile: { source: "beta_flag" } });
    expect(evaluateFlag).toHaveBeenCalledWith(OTHER);
  });

  it("leaves unpersisted hosted users pending when Flags is unavailable", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    const evaluateFlag = vi.fn().mockRejectedValue(new Error("Flags unavailable"));
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag,
      policy: { mode: "hosted", valid: true },
    });

    await expect(resolver.resolveAccess(OTHER)).resolves.toMatchObject({
      admitted: false,
      status: "pending",
    });
  });

  it("is idempotent when the configured owner arrives concurrently", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag: vi.fn().mockResolvedValue(false),
      policy: {
        mode: "self-hosted",
        valid: true,
        bootstrapOwnerEmail: "owner@example.com",
      },
    });

    const decisions = await Promise.all(
      Array.from({ length: 8 }, () => resolver.resolveAccess(OWNER)),
    );

    expect(decisions.every((decision) => decision.admitted)).toBe(true);
    expect((await queries.listAdmittedOwnerUserIds()).filter((id) => id === OWNER.userId)).toEqual([
      OWNER.userId,
    ]);
    await expect(queries.getAccessProfile({ userId: OWNER.userId })).resolves.toMatchObject({
      source: "self_hosted_bootstrap",
    });
  });

  it("leaves a second singleton-source claimant pending", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    await queries.grantAccess({ userId: OWNER.userId, source: "self_hosted_bootstrap" });

    await expect(
      queries.grantAccess({ userId: OTHER.userId, source: "self_hosted_bootstrap" }),
    ).resolves.toMatchObject({ status: "pending", source: null });
  });

  it("makes persisted authority source-aware when a hosted database becomes self-hosted", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    await queries.grantAccess({ userId: OWNER.userId, source: "manual_grant" });
    await queries.grantAccess({ userId: "legacy-bootstrap", source: "bootstrap" });
    await queries.grantAccess({ userId: "legacy-manual", source: "manual_grant" });
    await queries.grantAccess({ userId: "legacy-beta", source: "beta_flag" });
    await queries.grantAccess({ userId: "invited-user", source: "household_invitation" });

    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag: vi.fn().mockResolvedValue(false),
      policy: {
        mode: "self-hosted",
        valid: true,
        bootstrapOwnerEmail: "owner@example.com",
      },
    });

    const ownerDecision = await resolver.resolveAccess(OWNER);
    const legacyDecisions = await Promise.all(
      ["legacy-bootstrap", "legacy-manual", "legacy-beta"].map((userId) =>
        resolver.resolveAccess({ userId, email: "legacy@example.com" }),
      ),
    );
    const invitationDecision = await resolver.resolveAccess({
      userId: "invited-user",
      email: "member@example.com",
    });

    expect(ownerDecision).toMatchObject({
      admitted: true,
      profile: { source: "self_hosted_bootstrap" },
    });
    expect(legacyDecisions).toEqual([
      expect.objectContaining({
        admitted: false,
        status: "pending",
        profile: expect.objectContaining({ source: "bootstrap" }),
      }),
      expect.objectContaining({
        admitted: false,
        status: "pending",
        profile: expect.objectContaining({ source: "manual_grant" }),
      }),
      expect.objectContaining({
        admitted: false,
        status: "pending",
        profile: expect.objectContaining({ source: "beta_flag" }),
      }),
    ]);
    expect(invitationDecision).toMatchObject({
      admitted: true,
      profile: { source: "household_invitation" },
    });
    await expect(queries.getAccessProfile({ userId: OWNER.userId })).resolves.toMatchObject({
      source: "self_hosted_bootstrap",
    });
    await expect(queries.getAccessProfile({ userId: "legacy-beta" })).resolves.toMatchObject({
      source: "beta_flag",
      status: "granted",
    });
  });

  it("does not re-admit a legacy owner when the self-hosted singleton is already claimed", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    await queries.grantAccess({ userId: OWNER.userId, source: "manual_grant" });
    await queries.grantAccess({ userId: "other-owner", source: "self_hosted_bootstrap" });
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag: vi.fn().mockResolvedValue(false),
      policy: {
        mode: "self-hosted",
        valid: true,
        bootstrapOwnerEmail: "owner@example.com",
      },
    });

    await expect(resolver.resolveAccess(OWNER)).resolves.toMatchObject({
      admitted: false,
      status: "pending",
      profile: { source: "manual_grant" },
    });
  });
});

describe("Household Guest", () => {
  const GUEST = { userId: "guest-1", email: "guest@example.com" };
  const HOUSEHOLD = { householdId: "household-1", ownerUserIds: ["owner-a", "owner-b"] };

  function setup(
    input: {
      policy?: Parameters<typeof createAdmissionResolver>[0]["policy"];
      blocked?: string[];
      household?: GuestHousehold | null;
    } = {},
  ) {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    const readGuestHousehold = vi.fn(async ({ userId }: { userId: string }) =>
      userId === GUEST.userId
        ? input.household === undefined
          ? HOUSEHOLD
          : input.household
        : null,
    );
    const deps = {
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag: vi.fn().mockResolvedValue(false),
      listAdmissionBlocks: async ({ userId }: { userId: string }) =>
        (input.blocked ?? []).includes(userId)
          ? [{ kind: "suspension", event: `suspension:${userId}`, exceptions: [] }]
          : [],
      readGuestHousehold,
      readGuestStanding: async ({ userId }: { userId: string }) =>
        userId === GUEST.userId ? ("household_inactive" as const) : null,
      policy: input.policy ?? { mode: "hosted" as const, valid: true as const },
    };
    return {
      queries,
      readGuestHousehold,
      resolver: createAdmissionResolver(deps),
      reader: createLocalAdmissionReader(deps),
    };
  }

  it("makes an unpaid member a read-only guest while an Owner of the household is admitted", async () => {
    const { queries, resolver, reader } = setup();
    await queries.grantAccess({ userId: "owner-b", source: "paid_access" });

    const decision = await resolver.resolveAccess(GUEST);

    expect(decision).toMatchObject({
      admitted: false,
      guest: { householdId: HOUSEHOLD.householdId },
    });
    await expect(reader.isCurrentlyAdmitted({ userId: GUEST.userId })).resolves.toBe(true);
  });

  it("collapses on the next request when the last admitted Owner stops being admitted, and returns with them", async () => {
    const blocked: string[] = [];
    const { queries, resolver } = setup({ blocked });
    await queries.grantAccess({ userId: "owner-a", source: "paid_access" });

    await expect(resolver.resolveAccess(GUEST)).resolves.toMatchObject({
      guest: { householdId: HOUSEHOLD.householdId },
    });

    blocked.push("owner-a");
    const collapsed = await resolver.resolveAccess(GUEST);
    expect(collapsed).toMatchObject({ admitted: false });
    expect(collapsed.guest).toBeUndefined();

    blocked.pop();
    await expect(resolver.resolveAccess(GUEST)).resolves.toMatchObject({
      guest: { householdId: HOUSEHOLD.householdId },
    });
  });

  it("is sponsored only by Paid Access, not by an Owner admitted another way", async () => {
    const { queries, resolver } = setup();
    await queries.grantAccess({ userId: "owner-a", source: "manual_grant" });
    await queries.grantAccess({ userId: "owner-b", source: "household_invitation" });

    expect((await resolver.resolveAccess(GUEST)).guest).toBeUndefined();
  });

  it("is not a guest when no Owner of the household is admitted", async () => {
    const { reader, resolver } = setup();

    const decision = await resolver.resolveAccess(GUEST);

    expect(decision).toMatchObject({ admitted: false, status: "pending" });
    expect(decision.guest).toBeUndefined();
    await expect(reader.isCurrentlyAdmitted({ userId: GUEST.userId })).resolves.toBe(false);
  });

  it("does not let one guest sponsor another", async () => {
    const { resolver } = setup({
      household: { householdId: "household-1", ownerUserIds: [GUEST.userId] },
    });

    const decision = await resolver.resolveAccess(GUEST);

    expect(decision.guest).toBeUndefined();
  });

  it("never makes a lapsed account a guest: Household Guest is for accounts that never paid", async () => {
    const { queries, reader, resolver } = setup({ blocked: [GUEST.userId] });
    await queries.grantAccess({ userId: "owner-a", source: "paid_access" });
    await queries.grantAccess({ userId: GUEST.userId, source: "paid_access" });

    const decision = await resolver.resolveAccess(GUEST);

    expect(decision.guest).toBeUndefined();
    await expect(reader.isCurrentlyAdmitted({ userId: GUEST.userId })).resolves.toBe(false);
  });

  it("never makes an account whose Paid Access ended a guest, whatever its blocks", async () => {
    const store = createInMemoryAccessProfileStore();
    const queries = createAccessProfileQueries(store);
    await queries.grantAccess({ userId: "owner-a", source: "paid_access" });
    await store.insertIfAbsent({
      userId: GUEST.userId,
      status: "pending",
      source: "paid_access",
      grantedAt: null,
    });
    const resolver = createAdmissionResolver({
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag: vi.fn().mockResolvedValue(false),
      readGuestHousehold: async () => HOUSEHOLD,
      policy: { mode: "hosted", valid: true },
    });

    expect((await resolver.resolveAccess(GUEST)).guest).toBeUndefined();
  });

  it("applies the guest's own blocks", async () => {
    const { queries, resolver } = setup({ blocked: [GUEST.userId] });
    await queries.grantAccess({ userId: "owner-a", source: "paid_access" });

    const decision = await resolver.resolveAccess(GUEST);

    expect(decision).toMatchObject({ admitted: false });
    expect(decision.guest).toBeUndefined();
  });

  it("leaves a fully admitted account admitted rather than a guest", async () => {
    const { queries, resolver } = setup();
    await queries.grantAccess({ userId: "owner-a", source: "paid_access" });
    await queries.grantAccess({ userId: GUEST.userId, source: "paid_access" });

    const decision = await resolver.resolveAccess(GUEST);

    expect(decision).toMatchObject({ admitted: true });
    expect(decision.guest).toBeUndefined();
  });

  describe("guest standing (#637)", () => {
    it("reads a member whose household has no paying Owner as an inactive household", async () => {
      const { reader } = setup();

      await expect(reader.guestStanding(GUEST.userId)).resolves.toBe("household_inactive");
    });

    it("has no standing while the guest is live", async () => {
      const { queries, reader } = setup();
      await queries.grantAccess({ userId: "owner-a", source: "paid_access" });

      await expect(reader.guestStanding(GUEST.userId)).resolves.toBeNull();
    });

    it("never blames the household for the guest's own block", async () => {
      const { queries, reader } = setup({ blocked: [GUEST.userId] });

      await expect(reader.guestStanding(GUEST.userId)).resolves.toBeNull();
      await queries.grantAccess({ userId: "owner-a", source: "paid_access" });
      await expect(reader.guestStanding(GUEST.userId)).resolves.toBeNull();
    });

    it("has no standing for an account that held Paid Access", async () => {
      const store = createInMemoryAccessProfileStore();
      await store.insertIfAbsent({
        userId: GUEST.userId,
        status: "pending",
        source: "paid_access",
        grantedAt: null,
      });
      const reader = createLocalAdmissionReader({
        accessProfiles: createAccessProfileQueries(store),
        readGuestHousehold: async () => HOUSEHOLD,
        readGuestStanding: async () => "household_inactive",
        policy: { mode: "hosted", valid: true },
      });

      await expect(reader.guestStanding(GUEST.userId)).resolves.toBeNull();
    });

    it("has no standing in self-hosted mode", async () => {
      const { reader } = setup({
        policy: { mode: "self-hosted", valid: true, bootstrapOwnerEmail: "owner@example.com" },
      });

      await expect(reader.guestStanding(GUEST.userId)).resolves.toBeNull();
    });
  });

  it("never reads guest households in self-hosted mode", async () => {
    const { queries, readGuestHousehold, resolver, reader } = setup({
      policy: { mode: "self-hosted", valid: true, bootstrapOwnerEmail: "owner@example.com" },
    });
    await queries.grantAccess({ userId: "owner-a", source: "self_hosted_bootstrap" });

    const decision = await resolver.resolveAccess(GUEST);

    expect(decision.guest).toBeUndefined();
    await expect(reader.isCurrentlyAdmitted({ userId: GUEST.userId })).resolves.toBe(false);
    expect(readGuestHousehold).not.toHaveBeenCalled();
  });
});

describe("local admission reader", () => {
  it("reads full admission from durable grants and blocks without evaluating Flags", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    await queries.grantAccess({ userId: "paid-1", source: "paid_access" });
    await queries.grantAccess({ userId: "blocked-1", source: "paid_access" });
    const reader = createLocalAdmissionReader({
      accessProfiles: { checkAccess: queries.checkAccess },
      listAdmissionBlocks: async ({ userId }) =>
        userId === "blocked-1" ? [{ kind: "deletion", event: "deletion", exceptions: [] }] : [],
      policy: { mode: "hosted", valid: true },
    });

    await expect(reader.isCurrentlyAdmitted({ userId: "paid-1" })).resolves.toBe(true);
    await expect(reader.isCurrentlyAdmitted({ userId: "blocked-1" })).resolves.toBe(false);
    await expect(reader.isCurrentlyAdmitted({ userId: "nobody" })).resolves.toBe(false);
  });

  it("honours only self-hosted provenance in self-hosted mode", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    await queries.grantAccess({ userId: "legacy-1", source: "beta_flag" });
    await queries.grantAccess({ userId: "member-1", source: "household_invitation" });
    const reader = createLocalAdmissionReader({
      accessProfiles: { checkAccess: queries.checkAccess },
      policy: { mode: "self-hosted", valid: true, bootstrapOwnerEmail: "owner@example.com" },
    });

    await expect(reader.isCurrentlyAdmitted({ userId: "legacy-1" })).resolves.toBe(false);
    await expect(reader.isCurrentlyAdmitted({ userId: "member-1" })).resolves.toBe(true);
  });
});
