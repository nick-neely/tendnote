import type { AccessDecision } from "@tendnote/domain";
import type { LegalDocument } from "@tendnote/domain/legal-documents";
import { describe, expect, it, vi } from "vitest";
import {
  type AccessState,
  accountOwnerUserId,
  decideAccessRoute,
  LAPSED_PATH,
  localFallbackOwnerUserId,
  ownerForActionOrThrow,
  REACCEPTANCE_PATH,
  resolveAccessState,
  type SessionUser,
} from "./access-state";

const USER: SessionUser = {
  id: "user-1",
  email: "a@b.com",
  emailVerified: true,
  name: "Ada",
  image: null,
};

const admittedDecision: AccessDecision = {
  admitted: true,
  status: "granted",
  profile: {
    userId: "user-1",
    status: "granted",
    source: "bootstrap",
    grantedAt: new Date(),
    selfContextOnboardingStatus: "not_started",
    selfContextOnboardingReminderAt: null,
    householdCheckinEnabled: false,
    eveApprovalMode: "ask",
    retentionDeadline: null,
    paidAccessSubscriptionId: null,
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
    expect(resolveAccess).toHaveBeenCalledWith({
      userId: "user-1",
      email: "a@b.com",
      emailVerified: true,
    });
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

describe("accountOwnerUserId (#607 an account's exits stay open while not admitted)", () => {
  it("speaks for an admitted account", () => {
    const state: AccessState = {
      state: "admitted",
      user: USER,
      ownerUserId: "user-1",
      decision: admittedDecision,
    };
    expect(accountOwnerUserId(state)).toBe("user-1");
  });

  it("speaks for a pending account too, so it can still export", () => {
    const state: AccessState = { state: "pending", user: USER, decision: pendingDecision };
    expect(accountOwnerUserId(state)).toBe("user-1");
  });

  it("speaks for nobody when signed out, unless a local-dev fallback owner is supplied", () => {
    expect(accountOwnerUserId({ state: "unauthenticated" })).toBeNull();
    expect(
      accountOwnerUserId({ state: "unauthenticated" }, { localFallbackOwnerUserId: "demo-user" }),
    ).toBe("demo-user");
  });
});

describe("re-acceptance gate (#614)", () => {
  const updatedTerms: LegalDocument = {
    key: "terms_of_service",
    title: "Terms of Service",
    version: "0.2",
    effectiveDate: "2026-11-01",
    path: "docs/legal/terms-of-service.md",
    reacceptance: { changes: ["Fair-use limits are now stated in Eve turns."] },
  };
  const deniedDecision: AccessDecision = { admitted: false, status: "denied", profile: null };

  it("puts an admitted account that owes a flagged version behind the gate", async () => {
    const state = await resolveAccessState(
      USER,
      vi.fn().mockResolvedValue(admittedDecision),
      vi.fn().mockResolvedValue([updatedTerms]),
    );

    expect(state).toMatchObject({ state: "reacceptance", documents: [updatedTerms] });
    // Gated state never hands out an owner id for product data.
    expect(state).not.toHaveProperty("ownerUserId");
  });

  it.each([
    ["pending", pendingDecision],
    ["blocked, such as Lapsed or a guest without a live household", deniedDecision],
  ])("gates a %s account too", async (_, decision) => {
    const state = await resolveAccessState(
      USER,
      vi.fn().mockResolvedValue(decision),
      vi.fn().mockResolvedValue([updatedTerms]),
    );

    expect(state.state).toBe("reacceptance");
  });

  it("leaves an account that owes nothing exactly as admission decided", async () => {
    const readOutstanding = vi.fn().mockResolvedValue([]);
    const state = await resolveAccessState(
      USER,
      vi.fn().mockResolvedValue(admittedDecision),
      readOutstanding,
    );

    expect(state.state).toBe("admitted");
    expect(readOutstanding).toHaveBeenCalledWith("user-1");
  });

  it("routes the gated account to the gate, never to a local fallback owner", () => {
    const state: AccessState = {
      state: "reacceptance",
      user: USER,
      decision: admittedDecision,
      documents: [updatedTerms],
    };

    expect(decideAccessRoute(state, { localFallbackOwnerUserId: "demo-user" })).toEqual({
      type: "redirect",
      to: REACCEPTANCE_PATH,
    });
    expect(() => ownerForActionOrThrow(decideAccessRoute(state))).toThrow(/updated terms/i);
  });

  it.each([
    ["admitted", admittedDecision],
    ["not admitted", pendingDecision],
  ])(
    "keeps an %s account's exits open at the gate, so refusing never blocks export or deletion",
    (_, decision) => {
      expect(
        accountOwnerUserId({
          state: "reacceptance",
          user: USER,
          decision,
          documents: [updatedTerms],
        }),
      ).toBe("user-1");
    },
  );
});

describe("Lapsed Account (#609)", () => {
  const retentionDeadline = new Date("2027-01-29T17:04:05.000Z");
  const lapsedDecision: AccessDecision = {
    admitted: false,
    status: "pending",
    profile: {
      ...(admittedDecision.profile as NonNullable<AccessDecision["profile"]>),
      status: "pending",
      source: null,
      grantedAt: null,
      retentionDeadline,
    },
  };

  it("is a not-admitted account whose profile carries a retention deadline", async () => {
    const state = await resolveAccessState(USER, async () => lapsedDecision);

    expect(state).toEqual({
      state: "lapsed",
      user: USER,
      decision: lapsedDecision,
      retentionDeadline,
    });
  });

  it("is never pending, and a never-paid account is never lapsed", async () => {
    await expect(resolveAccessState(USER, async () => pendingDecision)).resolves.toMatchObject({
      state: "pending",
    });
  });

  it("routes to the Lapsed area and refuses product actions, never a local fallback owner", () => {
    const state: AccessState = {
      state: "lapsed",
      user: USER,
      decision: lapsedDecision,
      retentionDeadline,
    };
    const route = decideAccessRoute(state, { localFallbackOwnerUserId: "demo-user" });

    expect(route).toEqual({ type: "redirect", to: LAPSED_PATH });
    expect(() => ownerForActionOrThrow(route)).toThrow(/Resubscribe/);
  });

  it("keeps export and deletion open to the account itself", () => {
    expect(
      accountOwnerUserId({
        state: "lapsed",
        user: USER,
        decision: lapsedDecision,
        retentionDeadline,
      }),
    ).toBe(USER.id);
  });

  it("owes re-acceptance like any other account", async () => {
    const state = await resolveAccessState(
      USER,
      async () => lapsedDecision,
      async () => [{ key: "terms" } as unknown as LegalDocument],
    );

    expect(state.state).toBe("reacceptance");
  });
});
