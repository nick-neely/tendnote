import { describe, expect, it } from "vitest";
import { createInMemoryFollowupLifecycleStore } from "../followups/in-memory-store";
import { createFollowupLifecycle } from "../followups/lifecycle";
import { createRelationshipAgenda } from "./query";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";
const WINDOW_START = new Date("2026-07-01T00:00:00Z");
const WINDOW_END = new Date("2026-07-07T23:59:59Z");

async function setup() {
  const store = createInMemoryFollowupLifecycleStore();
  const followups = createFollowupLifecycle(store);
  const agenda = createRelationshipAgenda(store);

  async function person(displayName: string, birthday: string | null, ownerUserId = OWNER) {
    return store.createPerson({
      ownerUserId,
      displayName,
      firstName: null,
      lastName: null,
      birthday,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
  }

  return { store, followups, agenda, person };
}

describe("relationship agenda deterministic foundation", () => {
  it("returns owner-scoped active follow-ups and birthdays as one ranked typed list", async () => {
    const { followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", "1990-07-05");
    const sam = await person("Sam Rivera", "1988-07-10");
    const intruder = await person("Hidden Person", "1980-07-04", OTHER_OWNER);

    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-06-29T12:00:00Z"),
    });
    await followups.createFollowup({
      ownerUserId: OTHER_OWNER,
      personId: intruder.id,
      reason: "Should not leak.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      limit: 10,
      directlyRequested: false,
    });

    expect(result).toMatchObject([
      {
        kind: "due_followup",
        personId: mara.id,
        personDisplayName: "Mara Lin",
        title: "Overdue follow-up for Mara Lin",
        reason: "Ask about the move.",
        trustLevel: "active_reminder",
        sensitivity: "normal",
        rank: 1,
      },
      {
        kind: "birthday",
        personId: mara.id,
        personDisplayName: "Mara Lin",
        title: "Mara Lin's birthday",
        trustLevel: "stored_profile_data",
        sensitivity: "normal",
        rank: 2,
      },
    ]);
    expect(result.map((candidate) => candidate.personId)).not.toContain(sam.id);
    expect(result.map((candidate) => candidate.personId)).not.toContain(intruder.id);
    expect(result[0]?.sourceRefs).toEqual([expect.objectContaining({ kind: "followup" })]);
    expect(result[1]?.sourceRefs).toEqual([{ kind: "person", id: mara.id }]);
  });

  it("keeps exact birthday windows precise unless the query is broad", async () => {
    const { agenda, person } = await setup();
    const casey = await person("Casey", "1990-07-12");

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        query: "anything next week?",
        includeKinds: ["birthday"],
      }),
    ).resolves.toEqual([]);

    const broad = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "who deserves a thought today?",
      includeKinds: ["birthday"],
    });

    expect(broad).toEqual([
      expect.objectContaining({
        kind: "birthday",
        personId: casey.id,
        title: "Upcoming birthday for Casey",
        reason: "Birthday is outside the requested window but inside the prep buffer.",
      }),
    ]);
  });

  it("filters same-owner follow-ups by the requested window end", async () => {
    const { followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);

    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Inside the window.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });
    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "After the window.",
      dueAt: new Date("2026-07-12T12:00:00Z"),
    });

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["due_followup"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "due_followup",
        reason: "Inside the window.",
      }),
    ]);
  });

  it("ranks due follow-ups ahead of birthday prep-buffer items in one mixed result", async () => {
    const { followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const casey = await person("Casey", "1990-07-12");

    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "who deserves a thought today?",
      includeKinds: ["due_followup", "birthday"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "due_followup",
        personId: mara.id,
        rank: 1,
      }),
      expect.objectContaining({
        kind: "birthday",
        personId: casey.id,
        title: "Upcoming birthday for Casey",
        rank: 2,
      }),
    ]);
  });

  it("honors kind filters and limit behavior without mutating follow-ups", async () => {
    const { store, followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", "1990-07-05");
    await person("Casey", "1989-07-06");
    const followup = await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["birthday"],
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("birthday");
    await expect(
      store.getFollowup({ ownerUserId: OWNER, followupId: followup.id }),
    ).resolves.toEqual(expect.objectContaining({ status: "open" }));
  });
});
