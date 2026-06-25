import { describe, expect, it } from "vitest";
import {
  createInMemorySourceRecordStore,
  createSourceRecordCapture,
  createSourceRecordResolution,
} from "./source-records";

describe("source record capture", () => {
  it("captures retained relationship context and returns a persisted review component reference", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());

    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Had lunch with Mark. He may be switching jobs.",
    });

    expect(result.sourceRecord).toMatchObject({
      ownerUserId: "user-1",
      content: "Had lunch with Mark. He may be switching jobs.",
      sourceType: "manual",
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    expect(result.component).toEqual({
      type: "source_record_review",
      sourceRecordId: result.sourceRecord.id,
    });
  });

  it("reloads a source-record review component from persisted state", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());
    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Logged that Nina is training for a fall marathon.",
    });

    const review = await capture.getSourceRecordReview({
      ownerUserId: "user-1",
      sourceRecordId: result.component.sourceRecordId,
    });

    expect(review).toEqual({
      component: result.component,
      sourceRecord: result.sourceRecord,
    });
  });

  it("does not reload another owner's source record review", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());
    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Remember that Priya prefers morning coffee chats.",
    });

    await expect(
      capture.getSourceRecordReview({
        ownerUserId: "user-2",
        sourceRecordId: result.component.sourceRecordId,
      }),
    ).resolves.toBeNull();
  });

  it("writes an audit log entry for capture", async () => {
    const store = createInMemorySourceRecordStore();
    const capture = createSourceRecordCapture(store);

    const result = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Logged that Theo is moving in September.",
    });

    await expect(store.listAuditLogEntries({ ownerUserId: "user-1" })).resolves.toEqual([
      expect.objectContaining({
        ownerUserId: "user-1",
        action: "source_record.capture",
        entityType: "source_record",
        entityId: result.sourceRecord.id,
        metadataJson: {
          sourceType: "manual",
          componentType: "source_record_review",
        },
      }),
    ]);
  });
});

describe("source record person resolution", () => {
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
