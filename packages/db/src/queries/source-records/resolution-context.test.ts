import { describe, expect, it } from "vitest";
import {
  createInMemorySourceRecordStore,
  createSourceRecordCapture,
  createSourceRecordResolution,
} from "../source-records";

describe("source record person context retrieval", () => {
  it("returns normal person context only from active source records linked to that person", async () => {
    const store = createInMemorySourceRecordStore();
    const capture = createSourceRecordCapture(store);
    const resolution = createSourceRecordResolution(store);

    const caleb = await store.createPerson({
      ownerUserId: "user-1",
      displayName: "Caleb",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const resolvedRecord = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Caleb is moving to Denver in August.",
      status: "pending_resolution",
      unresolvedMentions: [{ mentionText: "Caleb", candidatePersonIds: [caleb.id] }],
    });
    const [calebMention] = await store.listUnresolvedMentions({
      sourceRecordId: resolvedRecord.sourceRecord.id,
    });
    await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Someone from the climbing group mentioned a new gym.",
      status: "pending_resolution",
    });

    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: "user-1",
      sourceRecordId: resolvedRecord.sourceRecord.id,
      personId: caleb.id,
      role: "primary",
      unresolvedMentionId: calebMention?.id,
    });

    await expect(
      resolution.listSourceRecordsForPersonContext({
        ownerUserId: "user-1",
        personId: caleb.id,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: resolvedRecord.sourceRecord.id,
        content: "Caleb is moving to Denver in August.",
        status: "active",
      }),
    ]);
    await expect(
      resolution.listSourceRecordsForPersonContext({
        ownerUserId: "user-2",
        personId: caleb.id,
      }),
    ).resolves.toEqual([]);
  });
});
