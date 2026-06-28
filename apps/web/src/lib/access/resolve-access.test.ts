import {
  createAccessProfileQueries,
  createInMemoryAccessProfileStore,
} from "@tendnote/db/queries/access-profiles";
import { describe, expect, it, vi } from "vitest";
import { createPrivateBetaAccessResolver, type PrivateBetaFlagEvaluator } from "./resolve-access";

const PENDING_USER = "user-pending";
const BOOTSTRAP_USER = "user-bootstrap";

/**
 * Build a resolver over the real #84 access-profile semantics (in-memory store)
 * plus a deterministic flag evaluator, so tests never make a live Vercel call.
 * A bootstrap owner is seeded first so any later user starts genuinely pending.
 */
async function createHarness(evaluateFlag: PrivateBetaFlagEvaluator) {
  const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
  const resolver = createPrivateBetaAccessResolver({
    accessProfiles: { checkAccess: queries.checkAccess, grantAccess: queries.grantAccess },
    evaluateFlag,
  });

  const bootstrap = await queries.ensureAccessProfile({ userId: BOOTSTRAP_USER });
  if (bootstrap.status !== "granted") {
    throw new Error("Expected the first user to bootstrap as granted.");
  }

  return { queries, resolver };
}

describe("private beta access resolver", () => {
  it("durably admits a pending user the flag grants", async () => {
    const evaluateFlag = vi.fn<PrivateBetaFlagEvaluator>().mockResolvedValue(true);
    const { queries, resolver } = await createHarness(evaluateFlag);
    await queries.ensureAccessProfile({ userId: PENDING_USER });

    const decision = await resolver.resolveAccess({ userId: PENDING_USER, email: "a@b.com" });

    expect(decision.admitted).toBe(true);
    expect(decision.profile?.source).toBe("beta_flag");

    // The grant is persisted, so a later flag failure no longer matters.
    evaluateFlag.mockRejectedValue(new Error("flags provider down"));
    const repeat = await resolver.resolveAccess({ userId: PENDING_USER, email: "a@b.com" });
    expect(repeat.admitted).toBe(true);
  });

  it("leaves a flag-denied user pending and does not persist a grant", async () => {
    const evaluateFlag = vi.fn<PrivateBetaFlagEvaluator>().mockResolvedValue(false);
    const { queries, resolver } = await createHarness(evaluateFlag);
    await queries.ensureAccessProfile({ userId: PENDING_USER });

    const decision = await resolver.resolveAccess({ userId: PENDING_USER, email: "a@b.com" });

    expect(decision.admitted).toBe(false);
    expect(decision.status).toBe("pending");
    await expect(queries.getAccessProfile({ userId: PENDING_USER })).resolves.toMatchObject({
      status: "pending",
    });
  });

  it("admits via persisted access without ever evaluating the flag", async () => {
    const evaluateFlag = vi.fn<PrivateBetaFlagEvaluator>().mockResolvedValue(false);
    const { resolver } = await createHarness(evaluateFlag);

    const decision = await resolver.resolveAccess({ userId: BOOTSTRAP_USER });

    expect(decision.admitted).toBe(true);
    expect(evaluateFlag).not.toHaveBeenCalled();
  });

  it("fails closed when flag evaluation throws and there is no persisted access", async () => {
    const evaluateFlag = vi
      .fn<PrivateBetaFlagEvaluator>()
      .mockRejectedValue(new Error("flags provider unavailable"));
    const { queries, resolver } = await createHarness(evaluateFlag);
    await queries.ensureAccessProfile({ userId: PENDING_USER });

    const decision = await resolver.resolveAccess({ userId: PENDING_USER, email: "a@b.com" });

    expect(decision.admitted).toBe(false);
    expect(decision.status).toBe("pending");
  });

  it("admits despite a flag failure when persisted access already exists", async () => {
    const evaluateFlag = vi
      .fn<PrivateBetaFlagEvaluator>()
      .mockRejectedValue(new Error("flags provider unavailable"));
    const { resolver } = await createHarness(evaluateFlag);

    const decision = await resolver.resolveAccess({ userId: BOOTSTRAP_USER });

    expect(decision.admitted).toBe(true);
    expect(evaluateFlag).not.toHaveBeenCalled();
  });
});
