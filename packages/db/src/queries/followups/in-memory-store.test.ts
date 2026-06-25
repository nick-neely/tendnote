import { describe, expect, it } from "vitest";
import { createInMemoryFollowupStore } from "./in-memory-store";

const OWNER = "user-1";
const PERSON = "person-1";

function followupInput(
  overrides: Partial<
    Parameters<ReturnType<typeof createInMemoryFollowupStore>["createFollowup"]>[0]
  > = {},
) {
  return {
    ownerUserId: OWNER,
    personId: PERSON,
    reason: "Reconnect.",
    dueAt: new Date("2026-07-01T00:00:00Z"),
    status: "open" as const,
    ...overrides,
  };
}

describe("in-memory follow-up store", () => {
  it("lists follow-ups for an owner and person", async () => {
    const store = createInMemoryFollowupStore();
    const created = await store.createFollowup(followupInput());

    const listed = await store.listFollowupsForPerson({ ownerUserId: OWNER, personId: PERSON });

    expect(listed.map((followup) => followup.id)).toEqual([created.id]);
  });

  it("is owner-scoped and person-scoped", async () => {
    const store = createInMemoryFollowupStore();
    await store.createFollowup(followupInput());

    expect(
      await store.listFollowupsForPerson({ ownerUserId: "intruder", personId: PERSON }),
    ).toEqual([]);
    expect(
      await store.listFollowupsForPerson({ ownerUserId: OWNER, personId: "other-person" }),
    ).toEqual([]);
  });
});
