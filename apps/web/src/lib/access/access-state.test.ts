import type { AccessDecision } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  type AccessState,
  decideAccessRoute,
  localFallbackOwnerUserId,
  ownerForActionOrThrow,
  resolveAccessState,
  type SessionUser,
} from "./access-state";

const USER: SessionUser = { id: "user-1", email: "a@b.com", name: "Ada", image: null };

const admittedDecision: AccessDecision = {
  admitted: true,
  status: "granted",
  profile: {
    userId: "user-1",
    status: "granted",
    source: "bootstrap",
    grantedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

const pendingDecision: AccessDecision = { admitted: false, status: "pending", profile: null };

describe("decideAccessRoute", () => {
  it("admits an admitted user with their owner id", () => {
    const state: AccessState = {
      state: "admitted",
      user: USER,
      ownerUserId: "user-1",
      decision: admittedDecision,
    };

    expect(decideAccessRoute(state)).toEqual({ type: "admitted", ownerUserId: "user-1" });
  });

  it("routes a pending user to the limited pending area", () => {
    const state: AccessState = { state: "pending", user: USER, decision: pendingDecision };

    expect(decideAccessRoute(state)).toEqual({ type: "redirect", to: "/pending" });
  });

  it("redirects an unauthenticated hosted request to sign-in", () => {
    expect(decideAccessRoute({ state: "unauthenticated" })).toEqual({
      type: "redirect",
      to: "/sign-in",
    });
  });

  it("admits an unauthenticated request only with a local-dev fallback owner", () => {
    expect(
      decideAccessRoute({ state: "unauthenticated" }, { localFallbackOwnerUserId: "demo-user" }),
    ).toEqual({ type: "admitted", ownerUserId: "demo-user" });
  });

  it("never uses a fallback for a pending user", () => {
    const state: AccessState = { state: "pending", user: USER, decision: pendingDecision };

    expect(decideAccessRoute(state, { localFallbackOwnerUserId: "demo-user" })).toEqual({
      type: "redirect",
      to: "/pending",
    });
  });
});

describe("resolveAccessState", () => {
  it("admits a signed-in user the resolver admits, exposing their owner id", async () => {
    const resolveAccess = vi.fn().mockResolvedValue(admittedDecision);

    const state = await resolveAccessState(USER, resolveAccess);

    expect(state).toMatchObject({ state: "admitted", ownerUserId: "user-1" });
    expect(resolveAccess).toHaveBeenCalledWith({ userId: "user-1", email: "a@b.com" });
  });

  it("leaves a signed-in but unadmitted user pending with identity but no owner id", async () => {
    const resolveAccess = vi.fn().mockResolvedValue(pendingDecision);

    const state = await resolveAccessState(USER, resolveAccess);

    expect(state.state).toBe("pending");
    // Pending state carries identity only — never an owner id to load data with.
    expect(state).not.toHaveProperty("ownerUserId");
    if (state.state === "pending") {
      expect(state.user.email).toBe("a@b.com");
    }
  });

  it("treats a missing session (signed out / never signed in) as unauthenticated", async () => {
    const resolveAccess = vi.fn().mockResolvedValue(pendingDecision);

    const state = await resolveAccessState(null, resolveAccess);

    expect(state).toEqual({ state: "unauthenticated" });
    // No session means no access evaluation at all.
    expect(resolveAccess).not.toHaveBeenCalled();
  });
});

describe("localFallbackOwnerUserId (#87 demo-user is local-dev only)", () => {
  it("returns no fallback owner in production", () => {
    expect(localFallbackOwnerUserId({ nodeEnv: "production" })).toBeUndefined();
    expect(
      localFallbackOwnerUserId({ nodeEnv: "production", devOwnerUserId: "demo-user" }),
    ).toBeUndefined();
  });

  it("falls back to the demo owner outside production", () => {
    expect(localFallbackOwnerUserId({ nodeEnv: "development" })).toBe("demo-user");
    expect(localFallbackOwnerUserId({ nodeEnv: "test" })).toBe("demo-user");
  });

  it("honors an explicit dev owner id outside production", () => {
    expect(localFallbackOwnerUserId({ nodeEnv: "development", devOwnerUserId: "owner-42" })).toBe(
      "owner-42",
    );
  });
});

describe("hosted vs local-dev access gating (#87)", () => {
  const pending: AccessState = { state: "pending", user: USER, decision: pendingDecision };
  const admitted: AccessState = {
    state: "admitted",
    user: USER,
    ownerUserId: "user-1",
    decision: admittedDecision,
  };

  it("denies an unauthenticated hosted request (no fallback in production)", () => {
    const fallback = localFallbackOwnerUserId({ nodeEnv: "production" });

    expect(
      decideAccessRoute({ state: "unauthenticated" }, { localFallbackOwnerUserId: fallback }),
    ).toEqual({
      type: "redirect",
      to: "/sign-in",
    });
  });

  it("denies a pending hosted request before any data loads", () => {
    const fallback = localFallbackOwnerUserId({ nodeEnv: "production" });

    expect(decideAccessRoute(pending, { localFallbackOwnerUserId: fallback })).toEqual({
      type: "redirect",
      to: "/pending",
    });
  });

  it("admits an admitted hosted request with its owner id", () => {
    const fallback = localFallbackOwnerUserId({ nodeEnv: "production" });

    expect(decideAccessRoute(admitted, { localFallbackOwnerUserId: fallback })).toEqual({
      type: "admitted",
      ownerUserId: "user-1",
    });
  });

  it("admits an unauthenticated local-dev request via the fallback owner", () => {
    const fallback = localFallbackOwnerUserId({ nodeEnv: "development" });

    expect(
      decideAccessRoute({ state: "unauthenticated" }, { localFallbackOwnerUserId: fallback }),
    ).toEqual({
      type: "admitted",
      ownerUserId: "demo-user",
    });
  });
});

describe("ownerForActionOrThrow (#87 server-action gate fails closed)", () => {
  it("returns the owner id for an admitted route", () => {
    expect(ownerForActionOrThrow({ type: "admitted", ownerUserId: "user-1" })).toBe("user-1");
  });

  it("throws for a pending caller instead of mutating data", () => {
    expect(() => ownerForActionOrThrow({ type: "redirect", to: "/pending" })).toThrow(
      /Private Beta Access/,
    );
  });

  it("throws for an unauthenticated caller", () => {
    expect(() => ownerForActionOrThrow({ type: "redirect", to: "/sign-in" })).toThrow(/signed in/);
  });
});
