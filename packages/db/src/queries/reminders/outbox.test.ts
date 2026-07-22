import { describe, expect, it } from "vitest";
import { createInMemoryBackgroundJobDeliveryStore } from "../background-job-deliveries";
import { scheduleReminderDeliveryOutbox } from "./outbox";

describe("Reminder durable outbox", () => {
  it("keeps future work unpublished and moves the idempotent row when its schedule changes", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const firstAt = new Date("2026-08-14T14:00:00.000Z");
    const replacementAt = new Date("2026-08-14T15:30:00.000Z");
    const first = await scheduleReminderDeliveryOutbox(store, {
      ownerUserId: "owner-1",
      jobId: "11111111-1111-1111-1111-111111111111",
      nextAttemptAt: firstAt,
    });
    const replacement = await scheduleReminderDeliveryOutbox(store, {
      ownerUserId: "owner-1",
      jobId: "11111111-1111-1111-1111-111111111111",
      nextAttemptAt: replacementAt,
    });

    expect(replacement.id).toBe(first.id);
    expect(replacement).toMatchObject({ status: "pending", nextAttemptAt: replacementAt });
    await expect(
      store.listDueBackgroundJobDeliveries({
        statuses: ["pending"],
        now: new Date("2026-08-14T15:29:59.000Z"),
        limit: 10,
      }),
    ).resolves.toEqual([]);
    await expect(
      store.listDueBackgroundJobDeliveries({
        statuses: ["pending"],
        now: replacementAt,
        limit: 10,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: first.id })]);
  });
});
