import {
  createAccessProfileQueries,
  createInMemoryAccessProfileStore,
} from "@tendnote/db/queries/access-profiles";
import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { createTendnoteAdmissionAuth } from "../../../../agent/agent/lib/eve-auth";
import { createPrivateBetaAccessResolver } from "./resolve-access";

const request = new Request("https://app.tendnote.test/eve/v1/session");

async function createBoundary(input: {
  policy: Parameters<typeof createPrivateBetaAccessResolver>[0]["policy"];
  evaluateFlag: Parameters<typeof createPrivateBetaAccessResolver>[0]["evaluateFlag"];
  user: { id: string; email: string };
}) {
  const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
  const admission = {
    accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
    evaluateFlag: input.evaluateFlag,
    policy: input.policy,
  };
  const web = createPrivateBetaAccessResolver(admission);
  const eve = createTendnoteAdmissionAuth({
    admission,
    getSession: vi.fn().mockResolvedValue({ user: input.user }),
    checkIngressBudget: vi.fn().mockResolvedValue({ allowed: true }),
  });

  return { eve, queries, web };
}

describe("shared Web/Eve admission boundary", () => {
  it("uses one persisted store for the self-hosted owner and unrelated pending user", async () => {
    const evaluateFlag = vi.fn().mockResolvedValue(true);
    const owner = { id: "owner-1", email: "owner@example.com" };
    const { eve, queries, web } = await createBoundary({
      evaluateFlag,
      policy: {
        mode: "self-hosted",
        valid: true,
        bootstrapOwnerEmail: owner.email,
      },
      user: owner,
    });

    await queries.ensureAccessProfile({ userId: "other-1" });
    await expect(
      web.resolveAccess({ userId: owner.id, email: owner.email }),
    ).resolves.toMatchObject({
      admitted: true,
      profile: { source: "self_hosted_bootstrap" },
    });
    await expect(eve(request)).resolves.toMatchObject({ principalId: owner.id });
    await expect(
      web.resolveAccess({ userId: "other-1", email: "other@example.com" }),
    ).resolves.toMatchObject({
      admitted: false,
      status: "pending",
    });

    const pendingAuth = createTendnoteAdmissionAuth({
      admission: {
        accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
        evaluateFlag,
        policy: {
          mode: "self-hosted",
          valid: true,
          bootstrapOwnerEmail: owner.email,
        },
      },
      getSession: vi.fn().mockResolvedValue({
        user: { id: "other-1", email: "other@example.com" },
      }),
      checkIngressBudget: vi.fn().mockResolvedValue({ allowed: true }),
    });
    await expect(pendingAuth(request)).rejects.toBeInstanceOf(ForbiddenError);
    expect(evaluateFlag).not.toHaveBeenCalled();
  });

  it("keeps invalid self-hosted configuration pending at both boundaries", async () => {
    const evaluateFlag = vi.fn().mockResolvedValue(true);
    const { eve, web } = await createBoundary({
      evaluateFlag,
      policy: {
        mode: "invalid",
        valid: false,
        diagnostic: { code: "missing_bootstrap_owner_email" },
      },
      user: { id: "owner-1", email: "owner@example.com" },
    });

    await expect(
      web.resolveAccess({ userId: "owner-1", email: "owner@example.com" }),
    ).resolves.toMatchObject({
      admitted: false,
      status: "pending",
    });
    await expect(eve(request)).rejects.toBeInstanceOf(ForbiddenError);
    expect(evaluateFlag).not.toHaveBeenCalled();
  });

  it("keeps hosted Flags unavailable fail-closed without a durable grant", async () => {
    const evaluateFlag = vi.fn().mockRejectedValue(new Error("Flags unavailable"));
    const { eve, web } = await createBoundary({
      evaluateFlag,
      policy: { mode: "hosted", valid: true },
      user: { id: "pending-1", email: "pending@example.com" },
    });

    await expect(
      web.resolveAccess({ userId: "pending-1", email: "pending@example.com" }),
    ).resolves.toMatchObject({
      admitted: false,
      status: "pending",
    });
    await expect(eve(request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps hosted durable grants authoritative when Flags is unavailable", async () => {
    const evaluateFlag = vi.fn().mockRejectedValue(new Error("Flags unavailable"));
    const { eve, queries, web } = await createBoundary({
      evaluateFlag,
      policy: { mode: "hosted", valid: true },
      user: { id: "granted-1", email: "granted@example.com" },
    });
    await queries.grantAccess({ userId: "granted-1", source: "manual_grant" });

    await expect(
      web.resolveAccess({ userId: "granted-1", email: "granted@example.com" }),
    ).resolves.toMatchObject({
      admitted: true,
      profile: { source: "manual_grant" },
    });
    await expect(eve(request)).resolves.toMatchObject({ principalId: "granted-1" });
    expect(evaluateFlag).not.toHaveBeenCalled();
  });
});
