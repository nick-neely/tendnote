import { describe, expect, it } from "vitest";
import {
  type AssetActionProposalPlan,
  MAX_ASSET_ACTION_PROPOSALS,
  planAssetMemoryActionProposal,
  planAssetMemoryActionProposals,
} from "./asset-action-proposals";
import type { AssetMemory, AssetMemoryValue } from "./asset-memories";
import type { Asset } from "./assets";

const NOW = new Date(2026, 6, 13, 9, 30);

const FRIDGE: Pick<Asset, "id" | "name" | "kind"> = {
  id: "asset-1",
  name: "Refrigerator water filter",
  kind: "item",
};

/**
 * A proposal's due date read as the local calendar day it lands on. Proposals are
 * day-precise (an asset fact has no clock time), so asserting the local day keeps
 * these tests honest in any timezone — a UTC-string slice would drift east of GMT.
 */
function dueDay(proposal: AssetActionProposalPlan | null): string | null {
  const due = proposal?.dueAt;
  if (!due) {
    return null;
  }
  const month = String(due.getMonth() + 1).padStart(2, "0");
  const day = String(due.getDate()).padStart(2, "0");
  return `${due.getFullYear()}-${month}-${day}`;
}

type MemoryFields = Pick<AssetMemory, "id" | "label" | "value" | "notes" | "status">;

function memory(overrides: Partial<MemoryFields> = {}): MemoryFields {
  return {
    id: "memory-1",
    label: "Replacement interval",
    value: { type: "interval", interval: 6, unit: "month" },
    notes: null,
    status: "active",
    ...overrides,
  };
}

function plan(overrides: Partial<MemoryFields> = {}): AssetActionProposalPlan | null {
  return planAssetMemoryActionProposal({ asset: FRIDGE, memory: memory(overrides), now: NOW });
}

describe("planAssetMemoryActionProposal", () => {
  it("turns a maintenance interval into a Routine proposal one interval out", () => {
    const proposal = plan();

    expect(proposal).not.toBeNull();
    expect(proposal?.reason).toBe("replacement");
    expect(proposal?.recurrence).toEqual({ interval: 6, unit: "month" });
    // The first occurrence sits one cadence step from today — the same roll-forward
    // rule a completed Routine uses, so birth and roll-forward can never disagree.
    expect(dueDay(proposal)).toBe("2027-01-13");
    expect(proposal?.title).toBe("Replace Refrigerator water filter");
  });

  it("names the memory it came from so the proposal is explainable", () => {
    const proposal = plan();

    expect(proposal?.assetMemoryId).toBe("memory-1");
    expect(proposal?.notes).toContain("Replacement interval");
    expect(proposal?.notes).toContain("Every 6 months");
  });

  it("turns a future warranty date into a one-time proposal with lead time", () => {
    const proposal = plan({
      id: "memory-warranty",
      label: "Warranty expires",
      value: { type: "date", date: "2026-09-01" },
    });

    expect(proposal?.reason).toBe("warranty_expiry");
    expect(proposal?.recurrence).toBeNull();
    // Fourteen days of lead: a warranty you hear about on its last day is useless.
    expect(dueDay(proposal)).toBe("2026-08-18");
    expect(proposal?.title).toBe("Check the warranty on Refrigerator water filter");
  });

  it("gives a renewal date a shorter lead than a warranty", () => {
    const proposal = plan({
      label: "Renews on",
      value: { type: "date", date: "2026-09-01" },
    });

    expect(proposal?.reason).toBe("renewal");
    expect(dueDay(proposal)).toBe("2026-08-25");
    expect(proposal?.title).toBe("Renew Refrigerator water filter");
  });

  it("clamps a lead time that would land in the past onto today", () => {
    // The warranty expires in three days: a 14-day lead would propose an action that
    // was already overdue the moment it was born. Today is the earliest honest date.
    const proposal = plan({
      label: "Warranty expires",
      value: { type: "date", date: "2026-07-16" },
    });

    expect(dueDay(proposal)).toBe("2026-07-13");
  });

  it("proposes nothing from a date that has already passed", () => {
    // A warranty that expired last year has nothing left to remind anyone about.
    // A born-overdue action from a stale fact is exactly the noise a calm register
    // forbids (#196: proactive asset behavior stays capped and explainable).
    expect(
      plan({ label: "Warranty expires", value: { type: "date", date: "2025-01-01" } }),
    ).toBeNull();
  });

  it("proposes nothing from a memory that has not been reviewed", () => {
    // Only reviewed (active) memories propose. An inferred, still-suggested fact must
    // not spawn a second review item downstream of its own pending review.
    expect(plan({ status: "suggested" })).toBeNull();
    expect(plan({ status: "dismissed" })).toBeNull();
  });

  it("proposes nothing from a memory that carries no date or interval", () => {
    const inert: (AssetMemoryValue | null)[] = [
      { type: "text", text: "EveryDrop EDR1RXD1" },
      { type: "amount", amount: 49.99, currency: "USD" },
      null,
    ];

    for (const value of inert) {
      expect(plan({ value, notes: "Bought at the hardware store" })).toBeNull();
    }
  });

  it("reads the reason off the label and the timing off the value", () => {
    // The value says *when*; the label says *what*. A dated replacement and an
    // interval replacement are the same work on different clocks.
    const dated = plan({ label: "Replace by", value: { type: "date", date: "2026-12-01" } });
    expect(dated?.reason).toBe("replacement");
    expect(dated?.title).toBe("Replace Refrigerator water filter");
    expect(dated?.recurrence).toBeNull();

    const serviced = plan({
      label: "Service interval",
      value: { type: "interval", interval: 1, unit: "year" },
    });
    expect(serviced?.reason).toBe("maintenance");
    expect(serviced?.title).toBe("Service Refrigerator water filter");
    expect(serviced?.recurrence).toEqual({ interval: 1, unit: "year" });
  });

  it("prefers the warranty reading over the bare word 'expires'", () => {
    const proposal = plan({
      label: "Warranty expires on",
      value: { type: "date", date: "2027-01-01" },
    });

    expect(proposal?.reason).toBe("warranty_expiry");
  });

  it("falls back to a dated reminder that names the fact it came from", () => {
    const proposal = plan({
      label: "Registration due",
      value: { type: "date", date: "2026-11-04" },
    });

    expect(proposal?.reason).toBe("dated_reminder");
    expect(proposal?.title).toBe("Registration due: Refrigerator water filter");
    // No invented lead: an unclassified date means exactly the day it states.
    expect(dueDay(proposal)).toBe("2026-11-04");
  });
});

describe("planAssetMemoryActionProposals", () => {
  const memories: MemoryFields[] = [
    memory({ id: "m1", label: "Replacement interval" }),
    memory({ id: "m2", label: "Warranty expires", value: { type: "date", date: "2026-09-01" } }),
    memory({ id: "m3", label: "Filter size", value: { type: "text", text: "EDR1RXD1" } }),
    memory({ id: "m4", label: "Renews on", value: { type: "date", date: "2026-10-01" } }),
    memory({
      id: "m5",
      label: "Service interval",
      value: { type: "interval", interval: 1, unit: "year" },
    }),
  ];

  it("skips the memories with nothing to remind about", () => {
    const plans = planAssetMemoryActionProposals({ asset: FRIDGE, memories, now: NOW });

    // m3 carries a bare fact — a filter size is recall, not a reminder.
    expect(plans.map((entry) => entry.assetMemoryId)).not.toContain("m3");
  });

  it("caps one pass so a busy asset can never flood the review queue", () => {
    const plans = planAssetMemoryActionProposals({ asset: FRIDGE, memories, now: NOW });

    expect(MAX_ASSET_ACTION_PROPOSALS).toBe(3);
    expect(plans).toHaveLength(MAX_ASSET_ACTION_PROPOSALS);
    // Deterministic: the cap keeps the store's oldest-first order, never a random slice.
    expect(plans.map((entry) => entry.assetMemoryId)).toEqual(["m1", "m2", "m4"]);
  });

  it("plans nothing for an asset whose memories are all inert", () => {
    const inert = memories.filter((entry) => entry.id === "m3");

    expect(planAssetMemoryActionProposals({ asset: FRIDGE, memories: inert, now: NOW })).toEqual(
      [],
    );
  });
});
