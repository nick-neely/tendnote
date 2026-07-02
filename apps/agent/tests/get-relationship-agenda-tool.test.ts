import { describe, expect, it, vi } from "vitest";

const { getRelationshipAgenda } = vi.hoisted(() => ({
  getRelationshipAgenda: vi.fn(),
}));

vi.mock("@tendnote/db/queries/relationship-agenda", () => ({
  getRelationshipAgenda,
}));

const { default: tool } = await import("../agent/tools/get_relationship_agenda");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

describe("get_relationship_agenda tool", () => {
  it("calls the shared owner-scoped agenda read model and returns typed candidates", async () => {
    getRelationshipAgenda.mockResolvedValue([
      {
        kind: "due_followup",
        personId: "person-1",
        personDisplayName: "Mara Lin",
        title: "Follow up with Mara Lin",
        reason: "Ask about the move.",
        dueAt: new Date("2026-07-02T12:00:00Z"),
        sourceRefs: [{ kind: "followup", id: "followup-1" }],
        trustLevel: "active_reminder",
        sensitivity: "normal",
        rank: 1,
      },
    ]);

    const result = await tool.execute(
      {
        windowStart: "2026-07-01T00:00:00Z",
        windowEnd: "2026-07-07T23:59:59Z",
        query: "anything coming up next week?",
        limit: 5,
        includeKinds: ["due_followup", "birthday"],
        directlyRequested: false,
      },
      ctx,
    );

    expect(getRelationshipAgenda).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      windowStart: new Date("2026-07-01T00:00:00Z"),
      windowEnd: new Date("2026-07-07T23:59:59Z"),
      query: "anything coming up next week?",
      limit: 5,
      includeKinds: ["due_followup", "birthday"],
      directlyRequested: false,
    });
    expect(result).toEqual({
      candidates: [
        {
          kind: "due_followup",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Follow up with Mara Lin",
          reason: "Ask about the move.",
          dueAt: "2026-07-02T12:00:00.000Z",
          sourceRefs: [{ kind: "followup", id: "followup-1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          rank: 1,
        },
      ],
      window: {
        start: "2026-07-01T00:00:00Z",
        end: "2026-07-07T23:59:59Z",
      },
      component: {
        type: "relationship_agenda",
        resultCount: 1,
      },
    });
  });
});
