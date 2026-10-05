import type { ServiceWideHold } from "@tendnote/db/queries/service-wide-hold";
import { describe, expect, it } from "vitest";
import {
  liftServiceWideHold,
  placeServiceWideHold,
  runServiceHoldCommand,
  type ServiceWideHoldDependencies,
} from "./service-wide-hold";

const PLACED = new Date("2026-10-04T12:00:00.000Z");
const LIFTED = new Date("2026-10-04T15:00:00.000Z");

function holdRecords() {
  const holds: (ServiceWideHold & { reason: string })[] = [];
  const deps: ServiceWideHoldDependencies = {
    findOpenServiceWideHold: async () => holds.find((hold) => !hold.liftedAt) ?? null,
    recordServiceWideHold: async ({ reason, placedAt }) => {
      const hold = { id: `hold_${holds.length + 1}`, reason, placedAt, liftedAt: null };
      holds.push(hold);
      return hold;
    },
    liftServiceWideHold: async ({ at }) => {
      const open = holds.find((hold) => !hold.liftedAt);
      if (!open) return null;
      open.liftedAt = at;
      return open;
    },
  };
  return { holds, deps };
}

describe("placeServiceWideHold", () => {
  it("records the hold with the operator's reason", async () => {
    const { holds, deps } = holdRecords();

    const result = await placeServiceWideHold(deps, { reason: "  scope unknown  ", now: PLACED });

    expect(result).toEqual({ holdId: "hold_1", placedAt: PLACED, alreadyHeld: false });
    expect(holds).toEqual([
      { id: "hold_1", reason: "scope unknown", placedAt: PLACED, liftedAt: null },
    ]);
  });

  it("keeps the open hold rather than opening a second", async () => {
    const { holds, deps } = holdRecords();
    await placeServiceWideHold(deps, { reason: "first", now: PLACED });

    const again = await placeServiceWideHold(deps, { reason: "second", now: LIFTED });

    expect(again).toEqual({ holdId: "hold_1", placedAt: PLACED, alreadyHeld: true });
    expect(holds).toHaveLength(1);
  });

  it("refuses a hold without a reason", async () => {
    const { holds, deps } = holdRecords();

    await expect(placeServiceWideHold(deps, { reason: "   " })).rejects.toThrow(/reason/);
    expect(holds).toHaveLength(0);
  });
});

describe("liftServiceWideHold", () => {
  it("records the lift on the open hold", async () => {
    const { holds, deps } = holdRecords();
    await placeServiceWideHold(deps, { reason: "incident", now: PLACED });

    const result = await liftServiceWideHold(deps, { now: LIFTED });

    expect(result).toEqual({ holdId: "hold_1", placedAt: PLACED, liftedAt: LIFTED });
    expect(holds[0]?.liftedAt).toEqual(LIFTED);
  });

  it("refuses when no hold is in force", async () => {
    const { deps } = holdRecords();

    await expect(liftServiceWideHold(deps)).rejects.toThrow(/No Service-Wide Hold/);
  });

  it("lets a new hold open after a lift", async () => {
    const { holds, deps } = holdRecords();
    await placeServiceWideHold(deps, { reason: "first", now: PLACED });
    await liftServiceWideHold(deps, { now: LIFTED });

    const second = await placeServiceWideHold(deps, { reason: "second" });

    expect(second).toMatchObject({ holdId: "hold_2", alreadyHeld: false });
    expect(holds).toHaveLength(2);
  });
});

describe("runServiceHoldCommand", () => {
  it("places a hold with the remaining words as its reason, and lifts it", async () => {
    const { holds, deps } = holdRecords();

    await runServiceHoldCommand(deps, ["place", "suspected", "credential", "leak"]);
    expect(holds[0]?.reason).toBe("suspected credential leak");

    await runServiceHoldCommand(deps, ["lift"]);
    expect(holds[0]?.liftedAt).toBeInstanceOf(Date);
  });

  it.each([[[]], [["place"]], [["lift", "now"]], [["pause", "reason"]]])(
    "refuses %j with the usage",
    async (args) => {
      const { holds, deps } = holdRecords();

      await expect(runServiceHoldCommand(deps, args)).rejects.toThrow(/Usage/);
      expect(holds).toHaveLength(0);
    },
  );
});
