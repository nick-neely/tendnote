import { describe, expect, it, vi } from "vitest";
import { applyEveOwnerHeaders, decideEveIngress, EVE_OWNER_HEADER } from "./eve-ingress";

describe("decideEveIngress", () => {
  it("admits a signed-in user with granted access, scoped to their own owner id", async () => {
    const isAdmitted = vi.fn().mockResolvedValue(true);

    const decision = await decideEveIngress({ id: "user-1" }, isAdmitted);

    expect(decision).toEqual({ type: "owner", ownerUserId: "user-1" });
    expect(isAdmitted).toHaveBeenCalledWith("user-1");
  });

  it("denies a signed-in pending user even with a local-dev fallback present", async () => {
    const isAdmitted = vi.fn().mockResolvedValue(false);

    const decision = await decideEveIngress({ id: "user-2" }, isAdmitted, {
      localFallbackOwnerUserId: "demo-user",
    });

    // Pending is authenticated-but-not-admitted, so the caller can answer 403.
    expect(decision).toEqual({ type: "denied", reason: "pending" });
  });

  it("denies an unauthenticated request when there is no fallback (hosted)", async () => {
    const isAdmitted = vi.fn();

    const decision = await decideEveIngress(null, isAdmitted, {});

    expect(decision).toEqual({ type: "denied", reason: "unauthenticated" });
    expect(isAdmitted).not.toHaveBeenCalled();
  });

  it("admits an unauthenticated request via the local-dev fallback owner only", async () => {
    const isAdmitted = vi.fn();

    const decision = await decideEveIngress(null, isAdmitted, {
      localFallbackOwnerUserId: "demo-user",
    });

    expect(decision).toEqual({ type: "owner", ownerUserId: "demo-user" });
    expect(isAdmitted).not.toHaveBeenCalled();
  });
});

describe("applyEveOwnerHeaders (owner-forgery prevention)", () => {
  it("strips a client-supplied owner header and sets the server-resolved owner", () => {
    const incoming = new Headers({ [EVE_OWNER_HEADER]: "attacker-owner", "x-other": "keep" });

    const headers = applyEveOwnerHeaders(incoming, { type: "owner", ownerUserId: "user-1" });

    expect(headers?.get(EVE_OWNER_HEADER)).toBe("user-1");
    expect(headers?.get("x-other")).toBe("keep");
  });

  it("returns no headers (denied) and never forwards a forged owner", () => {
    const incoming = new Headers({ [EVE_OWNER_HEADER]: "attacker-owner" });

    const headers = applyEveOwnerHeaders(incoming, { type: "denied", reason: "pending" });

    expect(headers).toBeNull();
  });
});
