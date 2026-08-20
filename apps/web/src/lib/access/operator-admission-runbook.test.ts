import {
  createAccessProfileQueries,
  createInMemoryAccessProfileStore,
} from "@tendnote/db/queries/access-profiles";
import {
  createHouseholdInvitationLifecycle,
  createHouseholdLifecycle,
  createInMemoryHouseholdInvitationStore,
} from "@tendnote/db/queries/households";
import { parseAdmissionPolicy } from "@tendnote/domain";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { createTendnoteAdmissionAuth } from "../../../../agent/agent/lib/eve-auth";
import { createPrivateBetaAccessResolver } from "./resolve-access";

const REQUEST = new Request("https://operator.example.test/eve/v1/session");
const OWNER = { id: "owner-1", email: "owner@example.test" };
const INVITEE = { id: "invitee-1", email: "member@example.test" };
const UNRELATED = { id: "unrelated-1", email: "other@example.test" };

type Admission = Parameters<typeof createPrivateBetaAccessResolver>[0];

async function assertSharedBoundary(input: {
  admission: Admission;
  user: { id: string; email: string };
  admitted: boolean;
  source?: string;
}) {
  const web = createPrivateBetaAccessResolver(input.admission);
  const eve = createTendnoteAdmissionAuth({
    admission: input.admission,
    getSession: vi.fn().mockResolvedValue({ user: input.user }),
    checkIngressBudget: vi.fn().mockResolvedValue({ allowed: true }),
  });

  const decision = await web.resolveAccess({ userId: input.user.id, email: input.user.email });
  expect(decision.admitted).toBe(input.admitted);
  if (input.source) {
    expect(decision.profile).toMatchObject({ source: input.source, status: "granted" });
  }

  if (input.admitted) {
    await expect(eve(REQUEST)).resolves.toMatchObject({ principalId: input.user.id });
  } else {
    await expect(eve(REQUEST)).rejects.toBeInstanceOf(ForbiddenError);
  }

  return decision;
}

describe("operator-owned self-hosted admission proof", () => {
  it("runs the documented journey through one hermetic persisted Web/Eve scenario", async () => {
    expect(parseAdmissionPolicy({})).toEqual({ mode: "hosted", valid: true });

    const policy = parseAdmissionPolicy({
      TENDNOTE_ADMISSION_MODE: " self-hosted ",
      TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: " Owner@Example.TEST ",
    });
    expect(policy).toEqual({
      mode: "self-hosted",
      valid: true,
      bootstrapOwnerEmail: OWNER.email,
    });

    const accessProfiles = createInMemoryAccessProfileStore();
    const queries = createAccessProfileQueries(accessProfiles);
    const invitationStore = createInMemoryHouseholdInvitationStore({
      accessProfiles,
      identities: [
        { id: OWNER.id, name: "Operator", email: OWNER.email },
        { id: INVITEE.id, name: "Household member", email: INVITEE.email },
      ],
    });
    const householdLifecycle = createHouseholdLifecycle(invitationStore.households);
    await householdLifecycle.createHousehold({
      ownerUserId: OWNER.id,
      name: "Operator home",
    });
    const invitations = createHouseholdInvitationLifecycle(invitationStore, {
      now: () => new Date("2026-08-19T12:00:00Z"),
    });
    const evaluateFlag = vi.fn().mockResolvedValue(true);
    const admission: Admission = {
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag,
      policy,
    };

    // The configured owner wins by identity, not by arrival order. Every
    // concurrent first visit observes the same one durable source.
    const ownerResolver = createPrivateBetaAccessResolver(admission);
    const ownerDecisions = await Promise.all(
      Array.from({ length: 8 }, () =>
        ownerResolver.resolveAccess({ userId: OWNER.id, email: OWNER.email }),
      ),
    );
    expect(ownerDecisions.every((decision) => decision.admitted)).toBe(true);
    expect(new Set(ownerDecisions.map((decision) => decision.profile?.source))).toEqual(
      new Set(["self_hosted_bootstrap"]),
    );
    await expect(queries.getAccessProfile({ userId: OWNER.id })).resolves.toMatchObject({
      status: "granted",
      source: "self_hosted_bootstrap",
    });
    await assertSharedBoundary({
      admission,
      user: OWNER,
      admitted: true,
      source: "self_hosted_bootstrap",
    });

    // An unrelated signup is created as pending and stays pending even though
    // a hosted Flags evaluator would return true. Self-hosted mode never calls it.
    await queries.ensureAccessProfile({ userId: UNRELATED.id });
    const unrelatedDecision = await assertSharedBoundary({
      admission,
      user: UNRELATED,
      admitted: false,
    });
    expect(unrelatedDecision.profile).toMatchObject({ status: "pending", source: null });
    await expect(queries.getAccessProfile({ userId: UNRELATED.id })).resolves.toMatchObject({
      status: "pending",
      source: null,
    });

    // A matching invite is the explicit second admission path. Before the
    // mailbox proof, the signed-up recipient remains pending.
    await queries.ensureAccessProfile({ userId: INVITEE.id });
    await expect(
      assertSharedBoundary({ admission, user: INVITEE, admitted: false }),
    ).resolves.toMatchObject({ profile: { status: "pending", source: null } });
    const sent = await invitations.sendInvitation({
      ownerUserId: OWNER.id,
      email: INVITEE.email,
    });
    await expect(
      invitations.acceptInvitation({
        secret: sent.secret,
        userId: INVITEE.id,
        userEmail: INVITEE.email,
      }),
    ).resolves.toEqual(expect.objectContaining({ householdId: expect.any(String) }));
    await expect(queries.getAccessProfile({ userId: INVITEE.id })).resolves.toMatchObject({
      status: "granted",
      source: "household_invitation",
    });
    await assertSharedBoundary({
      admission,
      user: INVITEE,
      admitted: true,
      source: "household_invitation",
    });
    expect(evaluateFlag).not.toHaveBeenCalled();

    // Invalid self-hosted configuration is safe and opaque at both boundaries.
    const invalidFlag = vi.fn().mockResolvedValue(true);
    const invalidPolicy = parseAdmissionPolicy({ TENDNOTE_ADMISSION_MODE: "self-hosted" });
    expect(invalidPolicy).toMatchObject({
      mode: "invalid",
      valid: false,
      diagnostic: { code: "missing_bootstrap_owner_email" },
    });
    const invalidAdmission: Admission = {
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag: invalidFlag,
      policy: invalidPolicy,
    };
    await queries.ensureAccessProfile({ userId: "invalid-visitor" });
    await expect(
      assertSharedBoundary({
        admission: invalidAdmission,
        user: { id: "invalid-visitor", email: "visitor@example.test" },
        admitted: false,
      }),
    ).resolves.toMatchObject({ admitted: false, status: "pending", profile: null });
    expect(invalidFlag).not.toHaveBeenCalled();

    // Hosted mode remains the explicit default and fails closed when Flags is
    // unavailable for an account without a persisted grant.
    const hostedFlag = vi.fn().mockRejectedValue(new Error("Flags unavailable"));
    const hostedAdmission: Admission = {
      accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
      evaluateFlag: hostedFlag,
      policy: parseAdmissionPolicy({}),
    };
    await queries.ensureAccessProfile({ userId: "flags-visitor" });
    await expect(
      assertSharedBoundary({
        admission: hostedAdmission,
        user: { id: "flags-visitor", email: "flags@example.test" },
        admitted: false,
      }),
    ).resolves.toMatchObject({ admitted: false, status: "pending" });
    // Web and Eve each fail closed against the unavailable hosted provider;
    // neither call can create a grant or override the pending row.
    expect(hostedFlag).toHaveBeenCalledTimes(2);
    await expect(queries.getAccessProfile({ userId: "flags-visitor" })).resolves.toMatchObject({
      status: "pending",
      source: null,
    });
  });
});
