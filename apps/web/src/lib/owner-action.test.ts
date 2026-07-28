import { type AccessDecision, GeneralActionValidationError } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

import {
  type AccessState,
  decideAccessRoute,
  ownerForActionOrThrow,
  resolveAccessState,
  type SessionUser,
} from "./access/access-state";
import { createOwnerActionRunner } from "./owner-action";
import { ProductRateLimitError } from "./rate-limit/guards";

const USER: SessionUser = { id: "owner-1", email: "owner@example.com", name: "Owner" };
const admittedDecision: AccessDecision = {
  admitted: true,
  status: "granted",
  profile: null,
};

function gateFor(state: AccessState, order?: string[]) {
  return async () => {
    order?.push("gate");
    return ownerForActionOrThrow(decideAccessRoute(state));
  };
}

function dependencies(gate: () => Promise<string>) {
  return {
    gate,
    resolveScope: vi.fn(async () => ({ scope: "private" as const, householdId: null })),
    enforceBudget: vi.fn(async () => undefined),
    reconcile: vi.fn(),
  };
}

describe("owner action seam", () => {
  it("structurally runs gate, parse, scope, budget, body, reconcile, and result in order", async () => {
    const order: string[] = [];
    const state = await resolveAccessState(USER, async () => admittedDecision);
    const deps = dependencies(gateFor(state, order));
    deps.resolveScope.mockImplementation(async () => {
      order.push("scope");
      return { scope: "private", householdId: null };
    });
    deps.enforceBudget.mockImplementation(async () => {
      order.push("budget");
    });
    deps.reconcile.mockImplementation(() => {
      order.push("reconcile");
    });
    const schema = z.string().transform((value) => {
      order.push("parse");
      return value.trim();
    });
    const runOwnerAction = createOwnerActionRunner(deps);

    const result = await runOwnerAction({
      schema,
      input: "  Replace the filter  ",
      visibilityChoice: () => "only_me",
      budget: { costCategory: "server-action" },
      body: async ({ input, ownerUserId, resolvedScope }) => {
        order.push("body");
        return {
          result: { ownerUserId, title: input, scope: resolvedScope?.scope },
          affectedScopes: [],
        };
      },
      affectedScopes: (outcome) => outcome.affectedScopes,
      result: (outcome) => {
        order.push("result");
        return outcome.result;
      },
    });

    expect(order).toEqual(["gate", "parse", "scope", "budget", "body", "reconcile", "result"]);
    expect(result).toEqual({
      ok: true,
      view: { ownerUserId: "owner-1", title: "Replace the filter", scope: "private" },
    });
  });

  it.each([
    {
      name: "unauthenticated",
      state: { state: "unauthenticated" } as AccessState,
      message: /signed in/,
    },
    {
      name: "pending",
      state: {
        state: "pending",
        user: USER,
        decision: { admitted: false, status: "pending", profile: null },
      } as AccessState,
      message: /Private Beta Access/,
    },
    {
      name: "Private Beta Access denial",
      state: {
        state: "pending",
        user: USER,
        decision: { admitted: false, status: "denied", profile: null },
      } as AccessState,
      message: /Private Beta Access/,
    },
  ])("denies $name before parsing", async ({ state, message }) => {
    const parse = vi.fn();
    const schema = z.string().superRefine(() => parse());
    const runOwnerAction = createOwnerActionRunner(dependencies(gateFor(state)));

    await expect(
      runOwnerAction({
        schema,
        input: "",
        body: async () => ({ value: "unreachable" }),
        result: (output) => output,
      }),
    ).rejects.toThrow(message);
    expect(parse).not.toHaveBeenCalled();
  });

  it("returns schema, domain, and product-budget failures through one result union", async () => {
    const state = await resolveAccessState(USER, async () => admittedDecision);
    const deps = dependencies(gateFor(state));
    const runOwnerAction = createOwnerActionRunner(deps);

    await expect(
      runOwnerAction({
        schema: z.string().min(1, "Name the action."),
        input: "",
        body: async () => "unreachable",
        result: (output) => output,
      }),
    ).resolves.toEqual({ ok: false, error: "Name the action." });

    await expect(
      runOwnerAction({
        schema: z.string(),
        input: "valid",
        body: async () => {
          throw new GeneralActionValidationError("That action cannot be reopened.");
        },
        result: (output) => output,
      }),
    ).resolves.toEqual({ ok: false, error: "That action cannot be reopened." });

    deps.enforceBudget.mockRejectedValueOnce(
      new ProductRateLimitError({
        allowed: false,
        limit: 1,
        count: 2,
        remaining: 0,
        resetAt: new Date("2026-07-28T03:00:00Z"),
        costCategory: "server-action",
        reason: "limit_exceeded",
      }),
    );
    await expect(
      runOwnerAction({
        schema: z.string(),
        input: "valid",
        budget: { costCategory: "server-action" },
        body: async () => "unreachable",
        result: (output) => output,
      }),
    ).resolves.toEqual({
      ok: false,
      error: "You've reached a usage limit for this action. Please try again shortly.",
    });
  });

  it("rethrows unexpected failures", async () => {
    const state = await resolveAccessState(USER, async () => admittedDecision);
    const runOwnerAction = createOwnerActionRunner(dependencies(gateFor(state)));

    await expect(
      runOwnerAction({
        schema: z.string(),
        input: "valid",
        body: async () => {
          throw new Error("database offline");
        },
        result: (output) => output,
      }),
    ).rejects.toThrow("database offline");
  });
});
