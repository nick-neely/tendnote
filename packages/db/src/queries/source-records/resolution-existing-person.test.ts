import { describe, expect, it } from "vitest";
import {
  createInMemorySourceRecordStore,
  createSourceRecordCapture,
  createSourceRecordResolution,
} from "../source-records";

describe("source record existing-person resolution", () => {
  it("links a pending source record to an existing person and records the resolution", async () => {
    const store = createInMemorySourceRecordStore();
    const capture = createSourceRecordCapture(store);
    const resolution = createSourceRecordResolution(store);

    const mark = await store.createPerson({
      ownerUserId: "user-1",
      displayName: "Mark",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "professional",
      closenessLevel: 3,
      profileBlurb: "Met through work.",
      source: "manual",
    });
    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Had lunch with Mark. He may be switching jobs.",
      status: "pending_resolution",
      unresolvedMentions: [
        {
          mentionText: "Mark",
          candidatePersonIds: [mark.id],
        },
      ],
    });
    const [mention] = await store.listUnresolvedMentions({
      sourceRecordId: result.sourceRecord.id,
    });

    const resolved = await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: "user-1",
      sourceRecordId: result.sourceRecord.id,
      personId: mark.id,
      role: "primary",
      unresolvedMentionId: mention?.id,
    });

    expect(resolved.sourceRecord.status).toBe("active");
    expect(resolved.link).toMatchObject({
      sourceRecordId: result.sourceRecord.id,
      personId: mark.id,
      role: "primary",
    });
    await expect(
      store.listUnresolvedMentions({ sourceRecordId: result.sourceRecord.id }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: mention?.id,
        status: "resolved",
        resolvedPersonId: mark.id,
      }),
    ]);
    await expect(store.listAuditLogEntries({ ownerUserId: "user-1" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "source_record.resolve_person",
          entityType: "source_record",
          entityId: result.sourceRecord.id,
          metadataJson: {
            personId: mark.id,
            role: "primary",
            unresolvedMentionId: mention?.id,
          },
        }),
      ]),
    );
  });

  it("schedules source-record embedding work after linking an existing person", async () => {
    const store = createInMemorySourceRecordStore();
    const capture = createSourceRecordCapture(store);
    const scheduled: Array<{ ownerUserId: string; recordKind: "source_record"; recordId: string }> =
      [];
    const resolution = createSourceRecordResolution(store, {
      async scheduleSourceRecordEmbedding(input) {
        scheduled.push(input);
      },
    });

    const mara = await store.createPerson({
      ownerUserId: "user-1",
      displayName: "Mara Lin",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Mara prefers handmade cooking gifts.",
    });

    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: "user-1",
      sourceRecordId: result.sourceRecord.id,
      personId: mara.id,
      role: "primary",
    });

    expect(scheduled).toEqual([
      {
        ownerUserId: "user-1",
        recordKind: "source_record",
        recordId: result.sourceRecord.id,
      },
    ]);
  });
});
