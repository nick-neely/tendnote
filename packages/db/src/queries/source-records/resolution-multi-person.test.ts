import { describe, expect, it } from "vitest";
import {
  createInMemorySourceRecordStore,
  createSourceRecordCapture,
  createSourceRecordResolution,
} from "../source-records";

describe("source record multi-person resolution", () => {
  it("supports multiple person links while unresolved mentions can be ignored or left unresolved", async () => {
    const store = createInMemorySourceRecordStore();
    const capture = createSourceRecordCapture(store);
    const resolution = createSourceRecordResolution(store);

    const nina = await store.createPerson({
      ownerUserId: "user-1",
      displayName: "Nina",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const theo = await store.createPerson({
      ownerUserId: "user-1",
      displayName: "Theo",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "colleague",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Nina introduced me to Theo and mentioned Jordan may join next time.",
      status: "pending_resolution",
      unresolvedMentions: [
        { mentionText: "Nina", candidatePersonIds: [nina.id] },
        { mentionText: "Jordan", candidatePersonIds: [] },
        { mentionText: "Maybe Maya", candidatePersonIds: [] },
      ],
    });
    const mentions = await store.listUnresolvedMentions({
      sourceRecordId: result.sourceRecord.id,
    });

    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: "user-1",
      sourceRecordId: result.sourceRecord.id,
      personId: nina.id,
      role: "primary",
      unresolvedMentionId: mentions.find((mention) => mention.mentionText === "Nina")?.id,
    });
    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: "user-1",
      sourceRecordId: result.sourceRecord.id,
      personId: theo.id,
      role: "mentioned",
    });
    await resolution.ignoreUnresolvedMention({
      ownerUserId: "user-1",
      sourceRecordId: result.sourceRecord.id,
      unresolvedMentionId: mentions.find((mention) => mention.mentionText === "Maybe Maya")?.id,
    });

    await expect(
      store.listSourceRecordPeople({ sourceRecordId: result.sourceRecord.id }),
    ).resolves.toEqual([
      expect.objectContaining({ personId: nina.id, role: "primary" }),
      expect.objectContaining({ personId: theo.id, role: "mentioned" }),
    ]);
    await expect(
      store.listUnresolvedMentions({ sourceRecordId: result.sourceRecord.id }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mentionText: "Nina",
          status: "resolved",
          resolvedPersonId: nina.id,
        }),
        expect.objectContaining({
          mentionText: "Jordan",
          status: "unresolved",
          resolvedPersonId: null,
        }),
        expect.objectContaining({
          mentionText: "Maybe Maya",
          status: "dismissed",
          resolvedPersonId: null,
        }),
      ]),
    );
  });
});
