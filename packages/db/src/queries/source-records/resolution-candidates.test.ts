import { describe, expect, it } from "vitest";
import {
  createInMemorySourceRecordStore,
  createSourceRecordCapture,
  createSourceRecordResolution,
} from "../source-records";

describe("source record person resolution candidates", () => {
  it("returns duplicate-name candidates without creating a person from a casual unresolved mention", async () => {
    const store = createInMemorySourceRecordStore();
    const capture = createSourceRecordCapture(store);
    const resolution = createSourceRecordResolution(store);

    const firstMark = await store.createPerson({
      ownerUserId: "user-1",
      displayName: "Mark",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: "College friend.",
      source: "manual",
    });
    const secondMark = await store.createPerson({
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
          candidatePersonIds: [firstMark.id, secondMark.id],
        },
      ],
    });

    await expect(
      resolution.findPersonResolutionCandidates({
        ownerUserId: "user-1",
        mentionText: "Mark",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: firstMark.id,
        displayName: "Mark",
      }),
      expect.objectContaining({
        id: secondMark.id,
        displayName: "Mark",
      }),
    ]);
    await expect(store.listPeople({ ownerUserId: "user-1" })).resolves.toHaveLength(2);
    await expect(
      store.listUnresolvedMentions({ sourceRecordId: result.sourceRecord.id }),
    ).resolves.toEqual([
      expect.objectContaining({
        mentionText: "Mark",
        status: "unresolved",
        resolvedPersonId: null,
        candidatePersonIds: [firstMark.id, secondMark.id],
      }),
    ]);
  });
});
