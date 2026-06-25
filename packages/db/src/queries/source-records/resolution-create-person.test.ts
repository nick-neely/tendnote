import { describe, expect, it } from "vitest";
import {
  createInMemorySourceRecordStore,
  createSourceRecordCapture,
  createSourceRecordResolution,
} from "../source-records";

describe("source record new-person resolution", () => {
  it("creates and links a new person only through an explicit resolution action", async () => {
    const store = createInMemorySourceRecordStore();
    const capture = createSourceRecordCapture(store);
    const resolution = createSourceRecordResolution(store);

    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Met Maya at the design meetup.",
      status: "pending_resolution",
      unresolvedMentions: [
        {
          mentionText: "Maya",
          candidatePersonIds: [],
        },
      ],
    });
    const [mention] = await store.listUnresolvedMentions({
      sourceRecordId: result.sourceRecord.id,
    });

    const resolved = await resolution.createAndLinkPersonToSourceRecord({
      ownerUserId: "user-1",
      sourceRecordId: result.sourceRecord.id,
      displayName: "Maya",
      role: "primary",
      unresolvedMentionId: mention?.id,
    });

    expect(resolved.person).toMatchObject({
      ownerUserId: "user-1",
      displayName: "Maya",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "other",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    expect(resolved.sourceRecord.status).toBe("active");
    expect(resolved.link).toMatchObject({
      sourceRecordId: result.sourceRecord.id,
      personId: resolved.person.id,
      role: "primary",
    });
    await expect(
      store.listUnresolvedMentions({ sourceRecordId: result.sourceRecord.id }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: mention?.id,
        status: "resolved",
        resolvedPersonId: resolved.person.id,
      }),
    ]);
    await expect(store.listAuditLogEntries({ ownerUserId: "user-1" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "source_record.create_and_resolve_person",
          entityType: "source_record",
          entityId: result.sourceRecord.id,
          metadataJson: {
            personId: resolved.person.id,
            displayName: "Maya",
            role: "primary",
            unresolvedMentionId: mention?.id,
          },
        }),
      ]),
    );
  });
});
