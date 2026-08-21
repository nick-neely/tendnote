import {
  HOUSEHOLD_INVITATION_RESEND_COOLDOWN_MS,
  HOUSEHOLD_SEAT_LIMIT,
  HouseholdAdmissionConflictError,
  HouseholdValidationError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryAccessProfileStore } from "../access-profiles/in-memory-store";
import { seedHouseholdWithMembers } from "./household-fixtures";
import { createInMemoryHouseholdInvitationStore } from "./in-memory-invitation-store";
import { createInMemoryHouseholdStore } from "./in-memory-store";
import { createHouseholdInvitationLifecycle } from "./invitations";

const OWNER = "owner-1";
const SENT_AT = new Date("2026-08-01T09:00:00Z");

let clock = SENT_AT;

async function setup(
  options: {
    members?: ReadonlyArray<readonly [string, "owner" | "member"]>;
    identities?: { id: string; name: string | null; email: string }[];
    accessProfiles?: ReturnType<typeof createInMemoryAccessProfileStore>;
    lockHook?: (input: { kind: "user" | "household"; id: string }) => Promise<void> | void;
  } = {},
) {
  clock = SENT_AT;
  const households = createInMemoryHouseholdStore();
  const store = createInMemoryHouseholdInvitationStore({
    households,
    accessProfiles: options.accessProfiles,
    identities: options.identities ?? [{ id: OWNER, name: "Alex", email: "alex@example.com" }],
    lockHook: options.lockHook,
  });
  const household = await seedHouseholdWithMembers(households, {
    ownerUserId: OWNER,
    name: "The Neely house",
    members: options.members ?? [[OWNER, "owner"]],
  });
  const invitations = createHouseholdInvitationLifecycle(store, { now: () => clock });
  return { households, store, household, invitations };
}

beforeEach(() => {
  clock = SENT_AT;
});

describe("sending an invitation", () => {
  it("creates a live invitation bound to the address, plus one durable send attempt", async () => {
    const { invitations, store, household } = await setup();

    const sent = await invitations.sendInvitation({
      ownerUserId: OWNER,
      email: " Sam@Example.COM ",
    });

    expect(sent.invitation).toMatchObject({
      email: "Sam@Example.COM",
      state: "pending",
      expiresAt: new Date("2026-08-15T09:00:00.000Z"),
    });
    expect(sent.householdName).toBe("The Neely house");
    expect(sent.secret).toEqual(expect.any(String));

    const stored = await store.listInvitations({ householdId: household.id });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.normalizedEmail).toBe("sam@example.com");
    // The reusable secret never lands in the row.
    expect(stored[0]?.secretDigest).not.toBe(sent.secret);

    expect(store.listDeliveries()).toEqual([
      expect.objectContaining({ invitationId: stored[0]?.id, status: "queued" }),
    ]);
  });

  /** An invitation is a capability, not an early membership (ADR 0213). */
  it("creates no membership for the invited person", async () => {
    const { invitations, households, household } = await setup();

    await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    expect(await households.listHouseholdMemberships({ householdId: household.id })).toHaveLength(
      1,
    );
  });

  it("records the transition without the address, the secret, or the link", async () => {
    const { invitations, households, store, household } = await setup();

    await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    const [entry] = await households.listAuditLogEntries({ ownerUserId: OWNER });
    const stored = (await store.listInvitations({ householdId: household.id }))[0];
    expect(entry).toMatchObject({
      action: "household.invitation_send",
      entityType: "household_invitation",
      entityId: stored?.id,
    });
    expect(JSON.stringify(entry?.metadataJson)).not.toContain("sam@example.com");
  });

  it("refuses a caller who is not an active owner of their household", async () => {
    const { invitations } = await setup({
      members: [
        [OWNER, "owner"],
        ["member-1", "member"],
      ],
    });

    await expect(
      invitations.sendInvitation({ ownerUserId: "member-1", email: "sam@example.com" }),
    ).rejects.toThrow(/owner/i);
  });

  it("refuses a caller with no household at all", async () => {
    const { invitations } = await setup();

    await expect(
      invitations.sendInvitation({ ownerUserId: "stranger-1", email: "sam@example.com" }),
    ).rejects.toThrow(/household/i);
  });

  it("refuses a second live invitation to the same address", async () => {
    const { invitations } = await setup();
    await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await expect(
      invitations.sendInvitation({ ownerUserId: OWNER, email: "SAM@example.com" }),
    ).rejects.toThrow(HouseholdValidationError);
  });

  it("refuses an address that already belongs to someone in the household", async () => {
    const { invitations } = await setup({
      members: [
        [OWNER, "owner"],
        ["member-1", "member"],
      ],
      identities: [
        { id: OWNER, name: "Alex", email: "alex@example.com" },
        { id: "member-1", name: "Sam", email: "sam@example.com" },
      ],
    });

    await expect(
      invitations.sendInvitation({ ownerUserId: OWNER, email: "Sam@example.com" }),
    ).rejects.toThrow(/already in this household/i);
  });

  /** The seat gate counts live invitations alongside active members (ADR 0213). */
  it("counts live invitations against the seat limit", async () => {
    const members: ReadonlyArray<readonly [string, "owner" | "member"]> = [
      [OWNER, "owner"],
      ...Array.from(
        { length: HOUSEHOLD_SEAT_LIMIT - 2 },
        (_, index) => [`member-${index}`, "member"] as const,
      ),
    ];
    const { invitations } = await setup({ members });

    // Seven seats are taken by people; the eighth goes to a live invitation.
    await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await expect(
      invitations.sendInvitation({ ownerUserId: OWNER, email: "jules@example.com" }),
    ).rejects.toThrow(/full/i);
  });

  it("lets a lapsed invitation's seat be reused by a fresh one to the same address", async () => {
    const { invitations, store, household } = await setup();
    await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    clock = new Date("2026-09-01T09:00:00Z");
    const resent = await invitations.sendInvitation({
      ownerUserId: OWNER,
      email: "sam@example.com",
    });

    const stored = await store.listInvitations({ householdId: household.id });
    expect(stored).toHaveLength(2);
    expect(stored.filter((invitation) => invitation.state === "expired")).toHaveLength(1);
    expect(resent.invitation.state).toBe("pending");
  });
});

describe("resending an invitation", () => {
  it("rotates the link, restarts the window, and queues a new attempt", async () => {
    const { invitations, store } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    clock = new Date(SENT_AT.getTime() + HOUSEHOLD_INVITATION_RESEND_COOLDOWN_MS);
    const resent = await invitations.resendInvitation({
      ownerUserId: OWNER,
      invitationId: sent.invitation.id,
    });

    expect(resent.secret).not.toBe(sent.secret);
    expect(resent.invitation.expiresAt).toEqual(new Date("2026-08-15T09:02:00.000Z"));
    expect(store.listDeliveries()).toHaveLength(2);

    // The previous link is dead the moment the new one exists.
    expect(await invitations.viewInvitation({ secret: sent.secret, viewer: null })).toEqual({
      state: "unusable",
    });
  });

  it("holds back a second press inside the cooldown", async () => {
    const { invitations } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    clock = new Date(SENT_AT.getTime() + 1000);
    await expect(
      invitations.resendInvitation({ ownerUserId: OWNER, invitationId: sent.invitation.id }),
    ).rejects.toThrow(HouseholdValidationError);
  });

  it("refuses to resend an invitation that is no longer live", async () => {
    const { invitations } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    await invitations.cancelInvitation({ ownerUserId: OWNER, invitationId: sent.invitation.id });

    clock = new Date(SENT_AT.getTime() + HOUSEHOLD_INVITATION_RESEND_COOLDOWN_MS);
    await expect(
      invitations.resendInvitation({ ownerUserId: OWNER, invitationId: sent.invitation.id }),
    ).rejects.toThrow(/no longer live/i);
  });

  it("refuses an invitation belonging to another household", async () => {
    const { invitations } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await expect(
      invitations.resendInvitation({ ownerUserId: "stranger-1", invitationId: sent.invitation.id }),
    ).rejects.toThrow();
  });
});

describe("cancelling an invitation", () => {
  it("kills the link immediately and sends nothing", async () => {
    const { invitations, store } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    const canceled = await invitations.cancelInvitation({
      ownerUserId: OWNER,
      invitationId: sent.invitation.id,
    });

    expect(canceled.state).toBe("canceled");
    expect(store.listDeliveries()).toHaveLength(1);
    expect(await invitations.viewInvitation({ secret: sent.secret, viewer: null })).toEqual({
      state: "unusable",
    });
  });

  it("frees the seat it was holding", async () => {
    const { invitations, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    expect(await invitations.countLiveInvitations({ householdId: household.id })).toBe(1);

    await invitations.cancelInvitation({ ownerUserId: OWNER, invitationId: sent.invitation.id });

    expect(await invitations.countLiveInvitations({ householdId: household.id })).toBe(0);
  });
});

describe("accepting an invitation", () => {
  it("grants Private Beta Access from the accepted invitation and leaves unrelated signups pending", async () => {
    const { invitations, store } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await invitations.acceptInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });
    const unrelated = await store.accessProfiles.insertIfAbsent({
      userId: "later-1",
      status: "pending",
      source: null,
      grantedAt: null,
    });

    expect(await store.accessProfiles.getByUserId("sam-1")).toMatchObject({
      status: "granted",
      source: "household_invitation",
    });
    expect(unrelated).toMatchObject({ status: "pending", source: null });
  });

  it("reclassifies an older hosted grant so the invitation remains authoritative in self-hosted mode", async () => {
    const accessProfiles = createInMemoryAccessProfileStore();
    await accessProfiles.insertIfAbsent({
      userId: "sam-1",
      status: "granted",
      source: "beta_flag",
      grantedAt: SENT_AT,
    });
    const { invitations, store } = await setup({ accessProfiles });
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await invitations.acceptInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });

    expect(await store.accessProfiles.getByUserId("sam-1")).toMatchObject({
      status: "granted",
      source: "household_invitation",
    });
  });

  it("refuses a self-hosted bootstrap owner without changing the invitation", async () => {
    const accessProfiles = createInMemoryAccessProfileStore();
    await accessProfiles.insertIfAbsent({
      userId: "sam-1",
      status: "granted",
      source: "self_hosted_bootstrap",
      grantedAt: SENT_AT,
    });
    const { invitations, households, store, household } = await setup({ accessProfiles });
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).rejects.toThrow(HouseholdValidationError);

    expect(await store.accessProfiles.getByUserId("sam-1")).toMatchObject({
      status: "granted",
      source: "self_hosted_bootstrap",
    });
    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "sam-1" }),
    ).toBeNull();
    expect((await store.listInvitations({ householdId: household.id }))[0]?.state).toBe("pending");
  });

  it("does not create membership when the admission write does not grant access", async () => {
    const baseAccessProfiles = createInMemoryAccessProfileStore();
    const pending = await baseAccessProfiles.insertIfAbsent({
      userId: "sam-1",
      status: "pending",
      source: null,
      grantedAt: null,
    });
    if (!pending) throw new Error("Failed to seed pending access profile.");
    const accessProfiles = {
      ...baseAccessProfiles,
      update: async () => pending,
    };
    const { invitations, households, household, store } = await setup({ accessProfiles });
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).rejects.toThrow(/admission could not be persisted/i);
    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "sam-1" }),
    ).toBeNull();
    expect(await store.accessProfiles.getByUserId("sam-1")).toMatchObject({ status: "pending" });
    expect((await store.listInvitations({ householdId: household.id }))[0]?.state).toBe("pending");
  });

  it("rolls back the access grant and invitation when membership persistence fails", async () => {
    const { invitations, households, store, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    const originalCreateMembership = households.createHouseholdMembership;
    households.createHouseholdMembership = async (...args) => {
      await originalCreateMembership(...args);
      throw new Error("membership write failed after insert");
    };

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).rejects.toThrow("membership write failed after insert");

    expect(await store.accessProfiles.getByUserId("sam-1")).toBeNull();
    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "sam-1" }),
    ).toBeNull();
    expect((await store.listInvitations({ householdId: household.id }))[0]?.state).toBe("pending");
  });

  it("rechecks a conflicting household before committing a raced acceptance", async () => {
    const { invitations, households, store, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    const otherHousehold = await seedHouseholdWithMembers(households, {
      ownerUserId: "sam-owner",
      name: "Sam's other place",
      members: [["sam-1", "member"]],
    });

    const listActiveMemberships = households.listActiveHouseholdMembershipsForUser;
    let reads = 0;
    households.listActiveHouseholdMembershipsForUser = async (input) => {
      const memberships = await listActiveMemberships(input);
      if (input.userId === "sam-1" && reads++ === 0) return [];
      return memberships;
    };

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).rejects.toThrow(HouseholdAdmissionConflictError);
    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "sam-1" }),
    ).toBeNull();
    expect(
      await households.getHouseholdMembership({
        householdId: otherHousehold.id,
        userId: "sam-1",
      }),
    ).toMatchObject({ status: "active" });
    expect(await store.accessProfiles.getByUserId("sam-1")).toBeNull();
  });

  it("creates the active membership only at acceptance, and consumes the link", async () => {
    const { invitations, households, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "Sam@Example.com" });

    const accepted = await invitations.acceptInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });

    expect(accepted.householdId).toBe(household.id);
    const membership = await households.getHouseholdMembership({
      householdId: household.id,
      userId: "sam-1",
    });
    expect(membership).toMatchObject({ status: "active", role: "member", invitedByUserId: OWNER });
    expect(await invitations.viewInvitation({ secret: sent.secret, viewer: null })).toEqual({
      state: "unusable",
    });
  });

  it("keeps an active household invitation usable after its inviter account is deleted", async () => {
    const { invitations, households, store, household } = await setup({
      members: [
        [OWNER, "owner"],
        ["owner-2", "owner"],
      ],
    });
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    await store.updateInvitation({
      invitationId: sent.invitation.id,
      patch: { invitedByUserId: null },
    });

    expect(
      await invitations.viewInvitation({
        secret: sent.secret,
        viewer: { userId: "sam-1", email: "sam@example.com", activeHouseholds: 0 },
      }),
    ).toMatchObject({ state: "ready", householdName: "The Neely house" });

    await invitations.acceptInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });

    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "sam-1" }),
    ).toMatchObject({ status: "active", role: "member", invitedByUserId: null });
  });

  /**
   * Pins the mailbox proof this ticket actually enforces, which is narrower than
   * the acceptance criterion's "invited verified email" wording.
   *
   * The proof is the emailed secret plus a session whose own address matches.
   * Better Auth's `emailVerified` is not consulted — the lifecycle is never told
   * it — because Tendnote sends no verification email, and requiring the flag
   * would leave every email/password account permanently unable to accept. This
   * test exists so that stops being true loudly rather than quietly: when
   * verification email ships and `emailVerified` becomes part of the proof, this
   * is the test that has to change, and its failure is the reminder.
   */
  it("proves the mailbox with the emailed secret and a matching session, not a verified flag", async () => {
    const { invitations, households, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    // No verification state is passed, and none is asked for.
    await invitations.acceptInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });

    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "sam-1" }),
    ).toMatchObject({ status: "active" });
  });

  it("refuses a session signed in as a different address", async () => {
    const { invitations, households, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "jules-1",
        userEmail: "jules@example.com",
      }),
    ).rejects.toThrow(HouseholdValidationError);
    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "jules-1" }),
    ).toBeNull();
  });

  /** A replay reports the committed outcome without duplicating either durable row. */
  it("is idempotent when the same recipient replays the accepted link", async () => {
    const { invitations, households, store, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    const first = await invitations.acceptInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).resolves.toEqual(first);
    expect(
      await households.listHouseholdMemberships({ householdId: household.id, status: "active" }),
    ).toHaveLength(2);
    expect(await store.accessProfiles.listByStatus("granted")).toHaveLength(1);
  });

  it("is idempotent when two acceptance requests race for the same recipient", async () => {
    const { invitations, households, store, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    const outcomes = await Promise.all([
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ]);

    expect(outcomes).toEqual([{ householdId: household.id }, { householdId: household.id }]);
    expect(
      await households.listHouseholdMemberships({ householdId: household.id, status: "active" }),
    ).toHaveLength(2);
    expect(await store.accessProfiles.listByStatus("granted")).toHaveLength(1);
  });

  it("serializes one recipient across different households", async () => {
    let releaseFirstUserLock!: () => void;
    let firstUserLocked!: () => void;
    const firstLock = new Promise<void>((resolve) => {
      firstUserLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirstUserLock = resolve;
    });
    let userLockCount = 0;
    const { invitations, households, store, household } = await setup({
      lockHook: async ({ kind, id }) => {
        if (kind !== "user" || id !== "sam-1" || userLockCount++ !== 0) return;
        firstUserLocked();
        await release;
      },
    });
    const otherHousehold = await seedHouseholdWithMembers(households, {
      ownerUserId: "sam-owner",
      name: "Sam's other place",
      members: [["sam-owner", "owner"]],
    });
    const firstInvitation = await invitations.sendInvitation({
      ownerUserId: OWNER,
      email: "sam@example.com",
    });
    const secondInvitation = await invitations.sendInvitation({
      ownerUserId: "sam-owner",
      email: "sam@example.com",
    });

    const first = invitations.acceptInvitation({
      secret: firstInvitation.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });
    await firstLock;

    let secondSettled = false;
    const second = invitations
      .acceptInvitation({
        secret: secondInvitation.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      })
      .then(
        () => {
          secondSettled = true;
          throw new Error("cross-household acceptance unexpectedly succeeded");
        },
        (error) => {
          secondSettled = true;
          expect(error).toBeInstanceOf(HouseholdAdmissionConflictError);
        },
      );
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    releaseFirstUserLock();
    await expect(first).resolves.toEqual({ householdId: household.id });
    await second;
    expect(
      await households.listActiveHouseholdMembershipsForUser({ userId: "sam-1" }),
    ).toHaveLength(1);
    expect(
      await households.getHouseholdMembership({ householdId: otherHousehold.id, userId: "sam-1" }),
    ).toBeNull();
    expect(await store.accessProfiles.listByStatus("granted")).toHaveLength(1);
  });

  it("rolls back one failed transaction without erasing a disjoint committed transaction", async () => {
    let releaseFirstUserLock!: () => void;
    let firstUserLocked!: () => void;
    const firstLock = new Promise<void>((resolve) => {
      firstUserLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirstUserLock = resolve;
    });
    let paused = false;
    const { invitations, households, store, household } = await setup({
      lockHook: async ({ kind, id }) => {
        if (kind !== "user" || id !== "sam-1" || paused) return;
        paused = true;
        firstUserLocked();
        await release;
      },
    });
    const otherHousehold = await seedHouseholdWithMembers(households, {
      ownerUserId: "sam-owner",
      name: "Sam's other place",
      members: [["sam-owner", "owner"]],
    });
    const firstInvitation = await invitations.sendInvitation({
      ownerUserId: OWNER,
      email: "sam@example.com",
    });
    const secondInvitation = await invitations.sendInvitation({
      ownerUserId: "sam-owner",
      email: "jules@example.com",
    });
    const originalCreateMembership = households.createHouseholdMembership;
    households.createHouseholdMembership = async (input) => {
      const membership = await originalCreateMembership(input);
      if (input.userId === "sam-1") {
        throw new Error("first transaction membership failed");
      }
      return membership;
    };

    const first = invitations.acceptInvitation({
      secret: firstInvitation.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });
    await firstLock;

    await expect(
      invitations.acceptInvitation({
        secret: secondInvitation.secret,
        userId: "jules-1",
        userEmail: "jules@example.com",
      }),
    ).resolves.toEqual({ householdId: otherHousehold.id });

    releaseFirstUserLock();
    await expect(first).rejects.toThrow("first transaction membership failed");

    expect(
      await households.getHouseholdMembership({
        householdId: household.id,
        userId: "sam-1",
      }),
    ).toBeNull();
    expect(await store.accessProfiles.getByUserId("sam-1")).toBeNull();
    expect((await store.listInvitations({ householdId: household.id }))[0]?.state).toBe("pending");
    expect(
      await households.getHouseholdMembership({
        householdId: otherHousehold.id,
        userId: "jules-1",
      }),
    ).toMatchObject({ status: "active" });
    expect(await store.accessProfiles.getByUserId("jules-1")).toMatchObject({
      status: "granted",
      source: "household_invitation",
    });
    expect((await store.listInvitations({ householdId: otherHousehold.id }))[0]?.state).toBe(
      "accepted",
    );
  });

  it("keeps an accepted link opaque to a different account", async () => {
    const { invitations, households, store, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    await invitations.acceptInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "jules-1",
        userEmail: "jules@example.com",
      }),
    ).rejects.toThrow(HouseholdValidationError);
    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "jules-1" }),
    ).toBeNull();
    expect(await store.accessProfiles.getByUserId("jules-1")).toBeNull();
  });

  it("refuses an expired link even though nothing rewrote the row", async () => {
    const { invitations } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    clock = new Date("2026-09-01T09:00:00Z");
    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).rejects.toThrow(HouseholdValidationError);
  });

  it("rechecks expiry after waiting for the household lock", async () => {
    let armed = false;
    const { invitations, store, household } = await setup({
      lockHook: ({ kind }) => {
        if (armed && kind === "household") {
          clock = new Date("2026-09-01T09:00:00Z");
        }
      },
    });
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    armed = true;

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).rejects.toThrow(HouseholdValidationError);
    expect(await store.accessProfiles.getByUserId("sam-1")).toBeNull();
    expect((await store.listInvitations({ householdId: household.id }))[0]?.state).toBe("pending");
  });

  it("explains an existing-workspace conflict without moving anybody", async () => {
    const { invitations, store } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    const samsHousehold = await seedHouseholdWithMembers(store.households, {
      ownerUserId: "sam-2",
      name: "Sam's other place",
      members: [["sam-1", "member"]],
    });

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).rejects.toThrow(HouseholdAdmissionConflictError);

    // Neither household changed, and the invitation is still live for later.
    expect(
      await store.households.getHouseholdMembership({
        householdId: samsHousehold.id,
        userId: "sam-1",
      }),
    ).toMatchObject({ status: "active" });
    expect((await invitations.viewInvitation({ secret: sent.secret, viewer: null })).state).toBe(
      "sign-in-required",
    );
  });

  it("refuses when the household filled up while the invitation was in flight", async () => {
    const { invitations, store, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    for (let index = 0; index < HOUSEHOLD_SEAT_LIMIT - 1; index += 1) {
      await store.households.createHouseholdMembership({
        householdId: household.id,
        userId: `late-${index}`,
        invitedByUserId: OWNER,
        role: "member",
        status: "active",
        invitedAt: SENT_AT,
        acceptedAt: SENT_AT,
        removedAt: null,
      });
    }

    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: "sam-1",
        userEmail: "sam@example.com",
      }),
    ).rejects.toThrow(/full/i);
  });
});

describe("declining an invitation", () => {
  it("ends the invitation with the same proof acceptance needs, and joins nothing", async () => {
    const { invitations, households, household } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await invitations.declineInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "SAM@example.com",
    });

    expect(await invitations.viewInvitation({ secret: sent.secret, viewer: null })).toEqual({
      state: "unusable",
    });
    expect(
      await households.getHouseholdMembership({ householdId: household.id, userId: "sam-1" }),
    ).toBeNull();
  });

  it("refuses a decline from a different address", async () => {
    const { invitations } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    await expect(
      invitations.declineInvitation({
        secret: sent.secret,
        userId: "jules-1",
        userEmail: "jules@example.com",
      }),
    ).rejects.toThrow(HouseholdValidationError);
  });
});

describe("what an owner can see", () => {
  it("lists their own invitations with the derived state and available actions", async () => {
    const { invitations } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    await invitations.sendInvitation({ ownerUserId: OWNER, email: "jules@example.com" });
    await invitations.cancelInvitation({ ownerUserId: OWNER, invitationId: sent.invitation.id });

    clock = new Date(SENT_AT.getTime() + HOUSEHOLD_INVITATION_RESEND_COOLDOWN_MS);
    const listed = await invitations.listInvitationsForOwner({ ownerUserId: OWNER });

    expect(listed).toEqual([
      // The one that ended stays for a while, with no actions left on it.
      expect.objectContaining({
        email: "sam@example.com",
        state: "canceled",
        canResend: false,
        canCancel: false,
      }),
      expect.objectContaining({ email: "jules@example.com", state: "pending", canResend: true }),
    ]);
  });

  /**
   * An invitation that ends tells the Owner nothing on its own — a decline, an
   * expiry, and a link nobody opened are indistinguishable if the row simply
   * disappears. It lingers, then gets out of the way.
   */
  it("keeps an invitation that ended visible for a week, then lets it go", async () => {
    const { invitations } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    await invitations.declineInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });

    clock = new Date(SENT_AT.getTime() + 6 * 24 * 60 * 60 * 1000);
    expect(await invitations.listInvitationsForOwner({ ownerUserId: OWNER })).toEqual([
      expect.objectContaining({ email: "sam@example.com", state: "declined" }),
    ]);
    // It never held a seat once it ended.
    expect(await invitations.countLiveInvitations({ householdId: "" })).toBe(0);

    clock = new Date(SENT_AT.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(await invitations.listInvitationsForOwner({ ownerUserId: OWNER })).toEqual([]);
  });

  /** Someone who joined is a person in the People list, not a lingering invitation. */
  it("drops an accepted invitation rather than shadowing the member it created", async () => {
    const { invitations } = await setup();
    const sent = await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });
    await invitations.acceptInvitation({
      secret: sent.secret,
      userId: "sam-1",
      userEmail: "sam@example.com",
    });

    expect(await invitations.listInvitationsForOwner({ ownerUserId: OWNER })).toEqual([]);
  });

  it("shows a member nothing, because invitations are an owner capability", async () => {
    const { invitations } = await setup({
      members: [
        [OWNER, "owner"],
        ["member-1", "member"],
      ],
    });
    await invitations.sendInvitation({ ownerUserId: OWNER, email: "sam@example.com" });

    expect(await invitations.listInvitationsForOwner({ ownerUserId: "member-1" })).toEqual([]);
  });
});
