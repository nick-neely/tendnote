import { describe, expect, it } from "vitest";
import { OTHER_OWNER, OWNER, setup, WINDOW_END, WINDOW_START } from "./query.test-helpers";

describe("relationship agenda — recent context", () => {
  it("includes capped recent context by default from active person-linked non-restricted source records", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const sam = await person("Sam Rivera", null);
    const recentRows: Array<{
      id: string;
      content: string;
      personId: string;
      sensitivity: "normal" | "sensitive" | "restricted";
    }> = [
      {
        id: "recent-1",
        content: "Mara logged a recent move update.",
        personId: mara.id,
        sensitivity: "normal",
      },
      {
        id: "recent-2",
        content: "Sam mentioned a job change.",
        personId: sam.id,
        sensitivity: "normal",
      },
      {
        id: "recent-3",
        content: "Mara shared a birthday plan.",
        personId: mara.id,
        sensitivity: "sensitive",
      },
      {
        id: "recent-4",
        content: "Fourth eligible context should stay out.",
        personId: sam.id,
        sensitivity: "normal",
      },
      {
        id: "recent-5",
        content: "Restricted context should stay out.",
        personId: mara.id,
        sensitivity: "restricted",
      },
    ];
    const records = await Promise.all(
      recentRows.map(async ({ id, content, personId, sensitivity }, index) => {
        const sourceRecord = await store.createSourceRecord({
          ownerUserId: OWNER,
          sourceType: "manual",
          content,
          rawContent: null,
          retentionPolicy: "retain",
          status: "active",
          confidence: "medium",
          sensitivity,
          scope: "private",
          importance: 3,
          metadataJson: {},
        });
        await store.linkSourceRecordPerson({
          sourceRecordId: sourceRecord.id,
          personId,
          role: "primary",
        });

        return {
          sourceRecord: {
            ...sourceRecord,
            id,
            createdAt: new Date(`2026-06-0${index + 1}T00:00:00Z`),
          },
          linkedPeople: [
            {
              id: personId,
              displayName: personId === mara.id ? mara.displayName : sam.displayName,
            },
          ],
        };
      }),
    );
    store.seedRecentSourceRecords(records);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "recent_context",
        personId: mara.id,
        personDisplayName: "Mara Lin",
        title: "Recent logged context for Mara Lin",
        reason: "Mara logged a recent move update.",
        trustLevel: "logged_context",
        sensitivity: "normal",
        rank: 1,
      }),
      expect.objectContaining({
        kind: "recent_context",
        personId: sam.id,
        reason: "Sam mentioned a job change.",
        rank: 2,
      }),
      expect.objectContaining({
        kind: "recent_context",
        personId: mara.id,
        reason: "Mara shared a birthday plan.",
        sensitivity: "sensitive",
        rank: 3,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Restricted context should stay out.");
    expect(JSON.stringify(result)).not.toContain("Fourth eligible context should stay out.");
  });

  it("ranks recent context below concrete agenda items and honors recent_context filters", async () => {
    const { store, followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", "1990-07-05");
    const reviewSourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara has pending logged context to review.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara shared a recent update.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });
    store.seedRecentSourceRecords([
      {
        sourceRecord,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
    ]);
    store.seedSourceRecordReviews([{ sourceRecord: reviewSourceRecord, linkedPeople: [] }]);

    const mixed = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(mixed.map((candidate) => candidate.kind)).toEqual([
      "due_followup",
      "birthday",
      "review_item",
      "recent_context",
    ]);

    const recentOnly = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["recent_context"],
    });

    expect(recentOnly).toEqual([
      expect.objectContaining({
        kind: "recent_context",
        reason: "Mara shared a recent update.",
        rank: 1,
      }),
    ]);

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeKinds: ["due_followup"],
      }),
    ).resolves.toEqual([expect.objectContaining({ kind: "due_followup" })]);
  });

  it("excludes personless, non-active, restricted, unclear-recency, and other-owner recent context", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const intruder = await person("Hidden Person", null, OTHER_OWNER);
    const eligible = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara shared a recent update.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const personless = {
      ...eligible,
      id: "personless-recent",
      content: "Personless should stay out.",
    };
    const dismissed = {
      ...eligible,
      id: "dismissed-recent",
      content: "Dismissed should stay out.",
      status: "dismissed" as const,
    };
    const archived = {
      ...eligible,
      id: "archived-recent",
      content: "Archived should stay out.",
      status: "archived" as const,
    };
    const pendingResolution = {
      ...eligible,
      id: "pending-recent",
      content: "Pending resolution should stay out.",
      status: "pending_resolution" as const,
    };
    const restricted = {
      ...eligible,
      id: "restricted-recent",
      content: "Restricted should stay out.",
      sensitivity: "restricted" as const,
    };
    const unclearRecency = {
      ...eligible,
      id: "unclear-recency",
      content: "Unclear recency should stay out.",
      createdAt: new Date("not a date"),
    };
    const otherOwner = {
      ...eligible,
      id: "other-owner-recent",
      ownerUserId: OTHER_OWNER,
      content: "Other owner should stay out.",
    };
    store.seedRecentSourceRecords([
      { sourceRecord: eligible, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
      { sourceRecord: personless, linkedPeople: [] },
      { sourceRecord: dismissed, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
      { sourceRecord: archived, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
      {
        sourceRecord: pendingResolution,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
      { sourceRecord: restricted, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
      {
        sourceRecord: unclearRecency,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
      {
        sourceRecord: otherOwner,
        linkedPeople: [{ id: intruder.id, displayName: intruder.displayName }],
      },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["recent_context"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "recent_context",
        reason: "Mara shared a recent update.",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Personless should stay out.");
    expect(JSON.stringify(result)).not.toContain("Dismissed should stay out.");
    expect(JSON.stringify(result)).not.toContain("Archived should stay out.");
    expect(JSON.stringify(result)).not.toContain("Pending resolution should stay out.");
    expect(JSON.stringify(result)).not.toContain("Restricted should stay out.");
    expect(JSON.stringify(result)).not.toContain("Unclear recency should stay out.");
    expect(JSON.stringify(result)).not.toContain("Other owner should stay out.");
  });
});
