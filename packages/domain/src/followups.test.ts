import { describe, expect, it } from "vitest";
import { followupUpdateSchema } from "./followups";

describe("followup update schema", () => {
  it("keeps absent keys absent (no default injection) so updates never wipe columns", () => {
    // A partial of the base schema would inject status/scope/householdId defaults
    // here and reset a snoozed, shared follow-up to open+private on a reason edit.
    const patch = followupUpdateSchema.parse({
      reason: "Congratulate on the promotion.",
      lastActorUserId: "user-1",
    });

    expect(Object.keys(patch).sort()).toEqual(["lastActorUserId", "reason"]);
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("scope");
    expect(patch).not.toHaveProperty("householdId");
  });

  it("preserves scope and household on a status-only lifecycle patch", () => {
    const patch = followupUpdateSchema.parse({ status: "completed", lastActorUserId: "user-2" });

    expect(patch).toEqual({ status: "completed", lastActorUserId: "user-2" });
    expect(patch).not.toHaveProperty("scope");
    expect(patch).not.toHaveProperty("householdId");
  });

  it("still validates provided fields and accepts explicit nulls", () => {
    expect(() => followupUpdateSchema.parse({ reason: "" })).toThrow();
    expect(followupUpdateSchema.parse({ cadence: null })).toEqual({ cadence: null });
  });
});
