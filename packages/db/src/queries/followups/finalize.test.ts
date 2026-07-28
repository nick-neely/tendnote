import type { Followup } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { finalizeReminderMutation } from "./finalize";

const followup = { id: "followup-1", ownerUserId: "owner-1" } as Followup;

describe("Follow-Up reminder mutation finalization", () => {
  it("reconciles the committed mutation before presentation hydration", async () => {
    const order: string[] = [];
    const reconcile = vi.fn(async () => {
      order.push("reconcile");
    });
    const hydrate = vi.fn(async () => {
      order.push("hydrate");
      throw new Error("household read failed");
    });

    await expect(
      finalizeReminderMutation({ result: followup, affectedScopes: [] }, { hydrate, reconcile }),
    ).rejects.toThrow("household read failed");
    expect(order).toEqual(["reconcile", "hydrate"]);
    expect(reconcile).toHaveBeenCalledWith(followup);
  });
});
