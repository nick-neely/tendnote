import type { HouseholdMembership, Memory, Person, SourceRecord } from "@tendnote/domain";
import { projectApprovedMemoryEmbeddedText } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createBriefGenerator, createInMemoryBriefStore } from "./briefs";
import { createFollowupLifecycle } from "./followups/lifecycle";
import { createHouseholdLifecycle } from "./households/lifecycle";
import type { HouseholdRecordShare } from "./households/types";
import { createMorningAgendaWorkflow, toMorningAgendaArtifact } from "./morning-agenda";
import { createInMemoryRelationshipAgendaStore } from "./relationship-agenda/in-memory-store";
import { createRelationshipAgenda } from "./relationship-agenda/query";
import { createInMemoryRelationshipContextSearchStore } from "./relationship-context-search/in-memory-store";
import { createRelationshipContextSearchQueries } from "./relationship-context-search/queries";
import {
  createInMemoryScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
} from "./scheduled-workflow-deliveries";
import { createHarness, EMBEDDING_CONFIG, OWNER } from "./semantic-retrieval/harness";
import { createSemanticRetrievalQueries } from "./semantic-retrieval/queries";
import type { EmbeddingAdapter } from "./semantic-retrieval/types";

const now = new Date("2026-06-26T00:00:00Z");
const householdId = "99999999-9999-4999-8999-999999999999";
const ownerUserId = "owner-1";
const memberUserId = "member-1";
const otherMemberUserId = "member-2";
const maraId = "11111111-1111-4111-8111-111111111111";

const vectorAdapter: EmbeddingAdapter = {
  async embedText(input) {
    return { vector: vectorFor(input.text), model: input.model, version: input.version };
  },
};

function vectorFor(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("job") || lower.includes("career")) return [1, 0, 0, 0];
  if (lower.includes("dinner")) return [0, 1, 0, 0];
  return [0, 0, 1, 0];
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: maraId,
    ownerUserId,
    displayName: "Mara Lin",
    firstName: "Mara",
    lastName: "Lin",
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function memory(overrides: Partial<Memory>): Memory {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    personId: maraId,
    ownerUserId,
    householdId: null,
    sourceRecordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    memoryType: "context",
    content: "Mara has a private job search note.",
    status: "approved",
    importance: 3,
    sensitivity: "normal",
    confidence: "medium",
    scope: "private",
    approvedAt: now,
    dismissedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sourceRecord(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ownerUserId,
    sourceType: "manual",
    content: "Mara has a private job search source.",
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
    confidence: "medium",
    sensitivity: "normal",
    scope: "private",
    importance: 3,
    metadataJson: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function membership(overrides: Partial<HouseholdMembership>): HouseholdMembership {
  return {
    id: `membership-${overrides.userId ?? "user"}`,
    householdId,
    userId: ownerUserId,
    invitedByUserId: ownerUserId,
    role: "member",
    status: "active",
    invitedAt: now,
    acceptedAt: now,
    removedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function recordShare(overrides: Partial<HouseholdRecordShare>): HouseholdRecordShare {
  return {
    id: `share-${overrides.recordId ?? "record"}`,
    householdId,
    recordKind: "memory",
    recordId: "record",
    sharedWithUserId: memberUserId,
    sharedByUserId: ownerUserId,
    createdAt: now,
    ...overrides,
  };
}

describe("Phase 4 household privacy boundaries", () => {
  it("preserves membership lifecycle history while removing active access", async () => {
    const store = createInMemoryRelationshipAgendaStore();
    const households = createHouseholdLifecycle(store);
    const { household } = await households.createHousehold({ ownerUserId, name: "Home" });
    await households.inviteMember({
      ownerUserId,
      householdId: household.id,
      invitedUserId: memberUserId,
    });
    await households.acceptInvite({ householdId: household.id, userId: memberUserId });

    const removed = await households.removeMember({
      ownerUserId,
      householdId: household.id,
      memberUserId,
    });

    expect(removed.status).toBe("removed");
    expect(await households.listActiveMembershipsForUser({ userId: memberUserId })).toEqual([]);
    await expect(
      store.getHouseholdMembership({ householdId: household.id, userId: memberUserId }),
    ).resolves.toMatchObject({ id: removed.id, status: "removed" });
    await expect(store.listAuditLogEntries({ ownerUserId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "household.member_remove" })]),
    );
  });

  it("proves exact recall hides private and unshared household records", async () => {
    const sharedMemory = memory({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ownerUserId,
      content: "Mara shared a job search note.",
      scope: "shared",
      householdId,
    });
    const householdSource = sourceRecord({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      ownerUserId,
      content: "Mara has a household job search source.",
      scope: "household",
      householdId,
    });
    const unsharedSource = sourceRecord({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ownerUserId: otherMemberUserId,
      content: "Mara has an unshared source-record job search note.",
      scope: "shared",
      householdId,
    });
    const exact = createRelationshipContextSearchQueries(
      createInMemoryRelationshipContextSearchStore({
        people: [person({}), person({ ownerUserId: otherMemberUserId })],
        memories: [
          memory({ content: "Mara has a private job search note." }),
          sharedMemory,
          memory({
            id: "99999999-1111-4111-8111-111111111111",
            content: "Mara has an unshared selected-member job search note.",
            scope: "shared",
            householdId,
          }),
        ],
        sourceRecords: [householdSource, unsharedSource],
        householdMemberships: [
          membership({ userId: ownerUserId, role: "owner" }),
          membership({ userId: memberUserId }),
        ],
        householdRecordShares: [recordShare({ recordKind: "memory", recordId: sharedMemory.id })],
      }),
    );

    const results = await exact.searchRelationshipContext({
      ownerUserId: memberUserId,
      query: "job search",
      recordKinds: ["memory", "source_record"],
      directlyRequested: true,
      limit: 10,
    });

    expect(results.map((result) => result.recordId).sort()).toEqual(
      [sharedMemory.id, householdSource.id].sort(),
    );
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: sharedMemory.id, visibilityLabel: "Specific people" }),
        expect.objectContaining({
          recordId: householdSource.id,
          visibilityLabel: "Whole household",
        }),
      ]),
    );
  });

  it("proves semantic retrieval hides private records and strips invisible person routing", async () => {
    const shares: HouseholdRecordShare[] = [];
    const { store, processor, createApprovedMemory } = createHarness({
      adapter: vectorAdapter,
      householdMemberships: [
        membership({ userId: OWNER, role: "member" }),
        membership({ userId: memberUserId, role: "owner" }),
        membership({ userId: otherMemberUserId, status: "removed", removedAt: now }),
      ],
      householdRecordShares: shares,
    });
    const privateMemory = await createApprovedMemory({
      ownerUserId: memberUserId,
      content: "Mara keeps private job search notes.",
    });
    const sharedMemory = await createApprovedMemory({
      ownerUserId: memberUserId,
      content: "Mara shared job search notes.",
      scope: "shared",
      householdId,
    });
    const unsharedMemory = await createApprovedMemory({
      ownerUserId: otherMemberUserId,
      content: "Mara has unshared job search notes.",
      scope: "shared",
      householdId,
    });
    shares.push(
      recordShare({ recordKind: "memory", recordId: sharedMemory.id, sharedWithUserId: OWNER }),
    );

    for (const record of [privateMemory, sharedMemory, unsharedMemory]) {
      await store.upsertRelationshipContextEmbedding({
        ownerUserId: record.ownerUserId,
        personId: record.personId,
        recordKind: "memory",
        recordId: record.id,
        embedding: vectorFor(record.content),
        embeddingModel: EMBEDDING_CONFIG.model,
        embeddingVersion: EMBEDDING_CONFIG.version,
        embeddingDimensions: 4,
        embeddedText: projectApprovedMemoryEmbeddedText(record),
        contentFingerprint: `fingerprint-${record.id}`,
        trustLevel: "confirmed_fact",
        sensitivity: record.sensitivity,
        sourceUpdatedAt: record.updatedAt,
      });
    }
    const semantic = createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);

    const results = await semantic.searchSemanticContext({
      ownerUserId: OWNER,
      query: "job search",
      recordKinds: ["memory"],
      limit: 10,
      minimumSimilarity: 0.5,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([sharedMemory.id]);
    expect(results[0]).toEqual(
      expect.objectContaining({
        visibilityChoice: "selected_members",
        visibilityLabel: "Specific people",
        relatedPersonId: null,
        relatedPersonDisplayName: null,
      }),
    );
    expect(processor).toBeDefined();
  });

  it("keeps agenda, review, brief, and Discord delivery inputs scoped before proactive sends", async () => {
    const store = createInMemoryRelationshipAgendaStore();
    const households = createHouseholdLifecycle(store);
    const followups = createFollowupLifecycle(store);
    const agenda = createRelationshipAgenda(store);
    const { household } = await households.createHousehold({ ownerUserId, name: "Home" });
    await households.inviteMember({
      ownerUserId,
      householdId: household.id,
      invitedUserId: memberUserId,
    });
    await households.acceptInvite({ householdId: household.id, userId: memberUserId });
    const mara = await store.createPerson({
      ownerUserId,
      displayName: "Mara Lin",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const sharedSource = await store.createSourceRecord({
      ownerUserId,
      sourceType: "manual",
      content: "Mara shared a dinner plan.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "shared",
      householdId: household.id,
      importance: 3,
      metadataJson: {},
    });
    const privateSource = await store.createSourceRecord({
      ownerUserId,
      sourceType: "manual",
      content: "Private dinner source should not leak.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const sharedRecentSource = await store.createSourceRecord({
      ownerUserId,
      sourceType: "manual",
      content: "Mara shared a recent dinner plan.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "shared",
      householdId: household.id,
      importance: 3,
      metadataJson: {},
    });
    const privateRecentSource = await store.createSourceRecord({
      ownerUserId,
      sourceType: "manual",
      content: "Private recent dinner source should not leak.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await store.createHouseholdRecordShare({
      householdId: household.id,
      recordKind: "source_record",
      recordId: sharedSource.id,
      sharedWithUserId: memberUserId,
      sharedByUserId: ownerUserId,
    });
    await store.createHouseholdRecordShare({
      householdId: household.id,
      recordKind: "source_record",
      recordId: sharedRecentSource.id,
      sharedWithUserId: memberUserId,
      sharedByUserId: ownerUserId,
    });
    const sharedFollowup = await followups.createFollowup({
      ownerUserId,
      personId: mara.id,
      reason: "Coordinate the shared dinner plan.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [memberUserId],
    });
    await followups.createFollowup({
      ownerUserId,
      personId: mara.id,
      reason: "Private reminder should not leak.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
    });
    store.seedRecentSourceRecords([
      {
        sourceRecord: sharedRecentSource,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
      {
        sourceRecord: privateRecentSource,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
    ]);
    store.seedSourceRecordReviews([
      {
        sourceRecord: sharedSource,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
      {
        sourceRecord: privateSource,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
    ]);

    const activeFollowups = await followups.listActiveFollowups({ ownerUserId: memberUserId });
    const candidates = await agenda.getRelationshipAgenda({
      ownerUserId: memberUserId,
      windowStart: new Date("2026-07-01T00:00:00Z"),
      windowEnd: new Date("2026-07-07T23:59:59Z"),
      includeKinds: ["due_followup", "review_item", "recent_context"],
    });

    expect(activeFollowups).toEqual([
      expect.objectContaining({ followup: expect.objectContaining({ id: sharedFollowup.id }) }),
    ]);
    expect(candidates.map((candidate) => candidate.reason)).toEqual([
      "Coordinate the shared dinner plan.",
      "Mara shared a dinner plan.",
      "Mara shared a recent dinner plan.",
    ]);
    expect(candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ visibilityLabel: "Specific people" })]),
    );

    const briefGenerator = createBriefGenerator(createInMemoryBriefStore(), agenda);
    const delivery = createScheduledWorkflowDeliveryService(
      createInMemoryScheduledWorkflowDeliveryStore(),
    );
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: memberUserId,
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-household-safe",
      allowSensitive: false,
    });
    const morningAgenda = createMorningAgendaWorkflow({
      generateBrief: (input) => briefGenerator.generateBrief(input),
      deliverDiscordScheduledArtifact: (input) => delivery.deliverDiscordScheduledArtifact(input),
    });
    const sent: string[] = [];

    const result = await morningAgenda.generateMorningAgenda({
      ownerUserId: memberUserId,
      localDate: "2026-07-04",
      now,
      deliverDiscord: true,
      sender: async (message) => {
        sent.push(message.content);
      },
    });

    expect(result.brief.items.map((item) => item.reason)).toEqual([
      "Coordinate the shared dinner plan.",
      "Mara shared a dinner plan.",
    ]);
    expect(result.artifact).toMatchObject({ sensitivity: "normal", persisted: true });
    expect(result.delivery).toMatchObject({ type: "sent" });
    expect(sent.join("\n")).not.toContain("Private");

    await expect(
      delivery.deliverDiscordScheduledArtifact({
        artifact: { ...toMorningAgendaArtifact(result.brief), sensitivity: "sensitive" },
        sender: async () => {
          throw new Error("sensitive artifact should not send");
        },
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "sensitive_content_filtered" });
  });
});
