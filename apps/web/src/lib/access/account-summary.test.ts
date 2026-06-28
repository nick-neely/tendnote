import type { AccessDecision } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { AccessState, SessionUser } from "./access-state";
import { accessSourceLabel, resolveAccountView } from "./account-summary";

const USER: SessionUser = { id: "user-1", email: "ada@example.com", name: "Ada", image: null };

function admittedState(sourceLabelSource: "bootstrap" | "beta_flag"): AccessState {
  const decision: AccessDecision = {
    admitted: true,
    status: "granted",
    profile: {
      userId: USER.id,
      status: "granted",
      source: sourceLabelSource,
      grantedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  return { state: "admitted", user: USER, ownerUserId: USER.id, decision };
}

describe("accessSourceLabel", () => {
  it("names each access source without echoing the panel title", () => {
    expect(accessSourceLabel("bootstrap")).toBe("Initial owner");
    expect(accessSourceLabel("beta_flag")).toBe("Beta invite");
    expect(accessSourceLabel("manual_grant")).toBe("Granted manually");
  });

  it("falls back to a generic granted label for an unknown source", () => {
    expect(accessSourceLabel(null)).toBe("Granted");
  });
});

describe("resolveAccountView", () => {
  it("renders an admitted user's identity and access source", () => {
    const view = resolveAccountView(admittedState("bootstrap"), undefined);

    expect(view).toEqual({
      type: "render",
      name: "Ada",
      email: "ada@example.com",
      sourceLabel: "Initial owner",
    });
  });

  it("redirects a pending user to the limited pending area (no account page)", () => {
    const state: AccessState = {
      state: "pending",
      user: USER,
      decision: { admitted: false, status: "pending", profile: null },
    };

    expect(resolveAccountView(state, "demo-user")).toEqual({ type: "redirect", to: "/pending" });
  });

  it("redirects an unauthenticated hosted request to sign-in", () => {
    expect(resolveAccountView({ state: "unauthenticated" }, undefined)).toEqual({
      type: "redirect",
      to: "/sign-in",
    });
  });

  it("renders a local-dev fallback owner instead of dead-ending the nav link", () => {
    expect(resolveAccountView({ state: "unauthenticated" }, "demo-user")).toEqual({
      type: "render",
      name: "Local development",
      email: "demo-user",
      sourceLabel: "Local development",
    });
  });
});
