import type { AccountDeletionDependencies } from "@tendnote/db/queries/account-deletion";
import { HouseholdValidationError } from "@tendnote/domain";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAccountDeletionHook } from "./account-deletion";

function dependencies(input: { journalFails?: boolean; held?: boolean } = {}) {
  const steps: string[] = [];
  const deps: AccountDeletionDependencies = {
    store: {
      commitIntent: async ({ userId, at }) => {
        steps.push("intent");
        return { userId, requestedAt: at, journaledAt: null, reason: "owner_request" };
      },
      findIntent: async () => null,
      listIntents: async () => [],
      isHeld: async () => input.held ?? false,
      markAttempted: async () => {},
      markJournaled: async () => {
        steps.push("journaled");
      },
      findAccountEmail: async () => "user_1@example.test",
      deleteAccount: async () => {
        steps.push("delete");
      },
    },
    journal: {
      write: async () => {
        if (input.journalFails) throw new Error("journal down");
        steps.push("journal");
      },
    },
    revokeSessions: async () => {
      steps.push("revoke");
    },
    cancelSubscriptions: async () => {
      steps.push("cancel");
    },
    confirmPurge: async () => {
      steps.push("confirm");
    },
    logger: { error: vi.fn() },
  };
  return { steps, deps };
}

describe("createAccountDeletionHook", () => {
  it("deletes in journal order and lets Better Auth finish the request", async () => {
    const { steps, deps } = dependencies();
    const hook = createAccountDeletionHook({
      dependencies: () => deps,
      assertAllowed: async () => {},
    });

    await expect(hook({ id: "user_1" })).resolves.toBeUndefined();
    expect(steps).toEqual(["intent", "revoke", "cancel", "journal", "journaled", "delete"]);
  });

  it("answers 202 Accepted and stops Better Auth deleting when only the intent committed", async () => {
    const { steps, deps } = dependencies({ journalFails: true });
    const hook = createAccountDeletionHook({
      dependencies: () => deps,
      assertAllowed: async () => {},
    });

    const error = await hook({ id: "user_1" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).statusCode).toBe(202);
    expect(steps).toEqual(["intent", "revoke", "cancel"]);
  });

  it("answers 202 Accepted and deletes nothing while a Legal Hold covers the account (#632)", async () => {
    const { steps, deps } = dependencies({ held: true });
    const hook = createAccountDeletionHook({
      dependencies: () => deps,
      assertAllowed: async () => {},
    });

    const error = await hook({ id: "user_1" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).statusCode).toBe(202);
    expect(steps).toEqual(["intent", "revoke", "cancel"]);
  });

  it("commits no intent when the household guard refuses", async () => {
    const { steps, deps } = dependencies();
    const hook = createAccountDeletionHook({
      dependencies: () => deps,
      assertAllowed: async () => {
        throw new Error("hand off ownership first");
      },
    });

    await expect(hook({ id: "user_1" })).rejects.toThrow("hand off ownership first");
    expect(steps).toEqual([]);
  });

  it("answers a household refusal as a 400 carrying what to do next", async () => {
    const { steps, deps } = dependencies();
    const hook = createAccountDeletionHook({
      dependencies: () => deps,
      assertAllowed: async () => {
        throw new HouseholdValidationError("Ask someone to become an owner first.");
      },
    });

    const error = await hook({ id: "user_1" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).statusCode).toBe(400);
    expect((error as APIError).body).toMatchObject({
      code: "HOUSEHOLD_REFUSED",
      message: "Ask someone to become an owner first.",
    });
    expect(steps).toEqual([]);
  });
});
