import { FIRST_VALUE_STEPS } from "@tendnote/domain/activation-milestones";
import { describe, expect, it } from "vitest";
import { createInMemoryActivationMilestoneStore } from "./in-memory-store";
import { createActivationMilestoneQueries } from "./queries";

function harness() {
  const store = createInMemoryActivationMilestoneStore();
  return { store, ...createActivationMilestoneQueries(store) };
}

describe("Activation Milestones", () => {
  it("stamps a step once, at its first occurrence", async () => {
    const { store, recordActivationMilestone } = harness();

    await recordActivationMilestone({ userId: "u1", milestone: "first_person_created" });
    const first = store.reachedAt("u1", "first_person_created");
    await recordActivationMilestone({ userId: "u1", milestone: "first_person_created" });

    expect(first).toBeInstanceOf(Date);
    expect(store.reachedAt("u1", "first_person_created")).toBe(first);
  });

  it("stamps First Value when the last step lands, in any order", async () => {
    const { store, recordActivationMilestone } = harness();
    const [lastStep, ...earlierSteps] = FIRST_VALUE_STEPS;

    for (const milestone of earlierSteps) {
      await recordActivationMilestone({ userId: "u1", milestone });
    }
    expect(await store.listReached({ userId: "u1" })).not.toContain("first_value_reached");

    await recordActivationMilestone({ userId: "u1", milestone: lastStep });

    expect(await store.listReached({ userId: "u1" })).toContain("first_value_reached");
  });

  it("keeps each account's milestones to itself", async () => {
    const { store, recordActivationMilestone } = harness();

    for (const milestone of FIRST_VALUE_STEPS) {
      await recordActivationMilestone({ userId: "u1", milestone });
    }

    expect(await store.listReached({ userId: "u2" })).toEqual([]);
  });

  it("announces each stamp once, so the funnel copy is never a backfill", async () => {
    const stamped: string[] = [];
    const { recordActivationMilestone } = createActivationMilestoneQueries(
      createInMemoryActivationMilestoneStore(),
      { onStamped: async ({ milestone }) => void stamped.push(milestone) },
    );

    for (const milestone of FIRST_VALUE_STEPS) {
      await recordActivationMilestone({ userId: "u1", milestone });
      await recordActivationMilestone({ userId: "u1", milestone });
    }

    expect(stamped).toEqual([...FIRST_VALUE_STEPS, "first_value_reached"]);
  });
});
