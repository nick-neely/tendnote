import { describe, expect, it, vi } from "vitest";
import { createAdmissionResolver } from "./admission";
import { createInMemoryAccessProfileStore } from "./in-memory-store";
import { createAccessProfileQueries } from "./queries";

const OWNER = { userId: "owner-1", email: "Owner@Example.com" };
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
});
