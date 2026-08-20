import { describe, expect, it } from "vitest";
import { generateOwnerDataExportArchive } from "./generator";
import type { OwnerDataExportRelationshipContext } from "./relationship-context";

const ACCOUNT = {
  id: "owner-1",
  name: "Owner Example",
  email: "owner@example.com",
  accessStatus: "granted" as const,
  accessSource: "self_hosted_bootstrap",
  grantedAt: new Date("2026-08-19T12:00:00.000Z"),
};

const NOW = new Date("2026-08-19T12:00:00.000Z");

function date(value: string) {
  return new Date(value);
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (!value) throw new Error("Expected fixture record.");
  return value;
}

function relationshipContext(): OwnerDataExportRelationshipContext {
  const context: OwnerDataExportRelationshipContext = {
    people: [
      {
        id: "person-owned",
        ownerUserId: "owner-1",
        displayName: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        birthday: "--12-10",
        relationshipType: "friend",
        closenessLevel: 2,
        profileBlurb: "Mathematician",
        source: "manual",
        createdAt: date("2026-08-01T12:00:00.000Z"),
        updatedAt: date("2026-08-02T12:00:00.000Z"),
      },
      {
        id: "person-other-owner",
        ownerUserId: "owner-2",
        displayName: "Grace Hopper",
        firstName: "Grace",
        lastName: "Hopper",
        birthday: null,
        relationshipType: "colleague",
        closenessLevel: 3,
        profileBlurb: null,
        source: "manual",
        createdAt: date("2026-08-01T12:00:00.000Z"),
        updatedAt: date("2026-08-02T12:00:00.000Z"),
      },
    ],
    contactMethods: [
      {
        id: "contact-owned",
        personId: "person-owned",
        type: "email",
        value: "ada@example.com",
        displayValue: "ada@example.com",
        normalizedValue: "ada@example.com",
        isPrimary: true,
        source: "manual",
        createdAt: date("2026-08-01T12:00:00.000Z"),
        updatedAt: date("2026-08-02T12:00:00.000Z"),
      },
      {
        id: "contact-other-owner",
        personId: "person-other-owner",
        type: "email",
        value: "grace@example.com",
        displayValue: null,
        normalizedValue: "grace@example.com",
        isPrimary: true,
        source: "manual",
        createdAt: date("2026-08-01T12:00:00.000Z"),
        updatedAt: date("2026-08-02T12:00:00.000Z"),
      },
    ],
    sourceRecords: [
      {
        id: "source-owned",
        ownerUserId: "owner-1",
        householdId: null,
        sourceType: "manual",
        content: "Ada is preparing a lecture.",
        rawContent: "provider raw payload must not be exported",
        retentionPolicy: "retain",
        status: "archived",
        confidence: "high",
        sensitivity: "restricted",
        scope: "private",
        importance: 4,
        metadataJson: {
          captureSurface: "account",
          discordHitlSessionId: "DISCORD_HITL_SESSION_SENTINEL",
          captureInputHash: "CAPTURE_INPUT_HASH_SENTINEL",
          interactionId: "INTERACTION_ID_SENTINEL",
        },
        createdAt: date("2026-08-03T12:00:00.000Z"),
        updatedAt: date("2026-08-04T12:00:00.000Z"),
      },
      {
        id: "source-other-owner",
        ownerUserId: "owner-2",
        householdId: "household-1",
        sourceType: "manual",
        content: "Other owner's private note.",
        rawContent: null,
        retentionPolicy: "retain",
        status: "active",
        confidence: "medium",
        sensitivity: "normal",
        scope: "shared",
        importance: 3,
        metadataJson: {},
        createdAt: date("2026-08-03T12:00:00.000Z"),
        updatedAt: date("2026-08-04T12:00:00.000Z"),
      },
    ],
    sourceRecordPeople: [
      {
        id: "source-person-owned",
        sourceRecordId: "source-owned",
        personId: "person-owned",
        role: "primary",
        createdAt: date("2026-08-03T12:00:00.000Z"),
      },
      {
        id: "source-person-shared-only",
        sourceRecordId: "source-other-owner",
        personId: "person-other-owner",
        role: "mentioned",
        createdAt: date("2026-08-03T12:00:00.000Z"),
      },
    ],
    unresolvedMentions: [
      {
        id: "mention-owned",
        sourceRecordId: "source-owned",
        mentionText: "Ada",
        candidatePersonIds: ["person-owned", "person-other-owner"],
        status: "unresolved",
        resolvedPersonId: "person-owned",
        createdAt: date("2026-08-03T12:00:00.000Z"),
        resolvedAt: null,
      },
      {
        id: "mention-other-owner",
        sourceRecordId: "source-other-owner",
        mentionText: "Grace",
        candidatePersonIds: ["person-other-owner"],
        status: "dismissed",
        resolvedPersonId: "person-other-owner",
        createdAt: date("2026-08-03T12:00:00.000Z"),
        resolvedAt: date("2026-08-04T12:00:00.000Z"),
      },
    ],
    memories: [
      {
        id: "memory-owned-restricted",
        personId: "person-owned",
        ownerUserId: "owner-1",
        householdId: null,
        sourceRecordId: "source-owned",
        memoryType: "context",
        content: "Ada is preparing a lecture.",
        status: "dismissed",
        importance: 4,
        sensitivity: "restricted",
        confidence: "high",
        scope: "private",
        approvedAt: null,
        dismissedAt: date("2026-08-05T12:00:00.000Z"),
        createdAt: date("2026-08-04T12:00:00.000Z"),
        updatedAt: date("2026-08-05T12:00:00.000Z"),
      },
      {
        id: "memory-shared-only",
        personId: "person-other-owner",
        ownerUserId: "owner-2",
        householdId: "household-1",
        sourceRecordId: "source-other-owner",
        memoryType: "context",
        content: "Do not include this shared record.",
        status: "approved",
        importance: 3,
        sensitivity: "normal",
        confidence: "medium",
        scope: "shared",
        approvedAt: date("2026-08-05T12:00:00.000Z"),
        dismissedAt: null,
        createdAt: date("2026-08-04T12:00:00.000Z"),
        updatedAt: date("2026-08-05T12:00:00.000Z"),
      },
    ],
    interactions: [
      {
        id: "interaction-owned",
        personId: "person-owned",
        ownerUserId: "owner-1",
        interactionType: "meeting",
        occurredAt: date("2026-08-06T12:00:00.000Z"),
        summary: "Lecture planning meeting",
        source: "manual",
        confidence: "high",
        createdAt: date("2026-08-06T12:00:00.000Z"),
        updatedAt: date("2026-08-06T12:00:00.000Z"),
      },
      {
        id: "interaction-other-owner",
        personId: "person-other-owner",
        ownerUserId: "owner-2",
        interactionType: "call",
        occurredAt: date("2026-08-06T12:00:00.000Z"),
        summary: "Other owner's interaction",
        source: "manual",
        confidence: "medium",
        createdAt: date("2026-08-06T12:00:00.000Z"),
        updatedAt: date("2026-08-06T12:00:00.000Z"),
      },
    ],
    followups: [
      {
        id: "followup-owned-suggested",
        personId: "person-owned",
        ownerUserId: "owner-1",
        reason: "Ask about the lecture",
        dueAt: date("2026-08-10T12:00:00.000Z"),
        status: "suggested",
        cadence: null,
        sourceRecordId: "source-owned",
        lastPromptedAt: null,
        householdId: null,
        scope: "private",
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        createdAt: date("2026-08-06T12:00:00.000Z"),
        updatedAt: date("2026-08-06T12:00:00.000Z"),
      },
      {
        id: "followup-other-owner",
        personId: "person-other-owner",
        ownerUserId: "owner-2",
        reason: "Other owner's follow-up",
        dueAt: date("2026-08-10T12:00:00.000Z"),
        status: "open",
        cadence: null,
        sourceRecordId: null,
        lastPromptedAt: null,
        householdId: "household-1",
        scope: "shared",
        createdByUserId: "owner-2",
        lastActorUserId: "owner-2",
        createdAt: date("2026-08-06T12:00:00.000Z"),
        updatedAt: date("2026-08-06T12:00:00.000Z"),
      },
    ],
    contextFacts: [
      {
        id: "context-owned-suggested",
        subject: { kind: "self", userId: "owner-1" },
        category: "work",
        content: "I work on privacy-preserving systems.",
        lifecycle: "suggested",
        sensitivity: "sensitive",
        provenance: { channel: "ambient", origin: "ambient", sourceRecordId: "source-owned" },
        suggestionEvidence: "A reviewable suggestion",
        creatorUserId: "owner-1",
        lastActorUserId: "owner-1",
        reviewedAt: null,
        archivedAt: null,
        createdAt: date("2026-08-07T12:00:00.000Z"),
        updatedAt: date("2026-08-07T12:00:00.000Z"),
      },
      {
        id: "context-other-member",
        subject: { kind: "self", userId: "owner-2" },
        category: "work",
        content: "Other member's self context.",
        lifecycle: "active",
        sensitivity: "normal",
        provenance: { channel: "account", origin: "direct", sourceRecordId: null },
        suggestionEvidence: null,
        creatorUserId: "owner-2",
        lastActorUserId: "owner-2",
        reviewedAt: date("2026-08-07T12:00:00.000Z"),
        archivedAt: null,
        createdAt: date("2026-08-07T12:00:00.000Z"),
        updatedAt: date("2026-08-07T12:00:00.000Z"),
      },
      {
        id: "context-household-native",
        subject: { kind: "household", householdId: "household-1" },
        category: "composition",
        content: "Household context must not be exported here.",
        lifecycle: "active",
        sensitivity: "normal",
        provenance: { channel: "account", origin: "direct", sourceRecordId: null },
        suggestionEvidence: null,
        creatorUserId: "owner-1",
        lastActorUserId: "owner-1",
        reviewedAt: date("2026-08-07T12:00:00.000Z"),
        archivedAt: null,
        createdAt: date("2026-08-07T12:00:00.000Z"),
        updatedAt: date("2026-08-07T12:00:00.000Z"),
      },
    ],
  };

  // These are generated database-only vectors. They must never become part of
  // the portable owner contract even when a row adapter supplies them.
  Object.assign(first(context.people), { searchVector: "PEOPLE_SEARCH_VECTOR_SENTINEL" });
  Object.assign(first(context.memories), { searchVector: "MEMORIES_SEARCH_VECTOR_SENTINEL" });
  return context;
}

function readStoredZipEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, contentStart - extraLength));
    entries.set(name, decoder.decode(bytes.slice(contentStart, contentStart + compressedSize)));
    offset = contentStart + compressedSize;
  }
  return entries;
}

function resource(entries: Map<string, string>, path: string) {
  const parsed = JSON.parse(entries.get(path) ?? "null") as { records: unknown[] } | null;
  if (!parsed) throw new Error(`Missing ${path}`);
  return parsed.records;
}

describe("owner relationship context export", () => {
  it("writes an owner-isolated relationship graph through the generated ZIP", async () => {
    const result = await generateOwnerDataExportArchive({
      ownerUserId: "owner-1",
      account: ACCOUNT,
      now: NOW,
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
      relationshipContext: relationshipContext(),
    });
    const entries = readStoredZipEntries(result.bytes);
    const manifest = JSON.parse(entries.get("manifest.json") ?? "null") as {
      includedFamilies: string[];
      exclusions: string[];
    };

    expect(manifest.includedFamilies).toEqual([
      "account profile",
      "People",
      "Contact Methods",
      "Memories",
      "Source Records",
      "Interactions",
      "Follow-Ups",
      "Self Context",
    ]);
    expect(manifest.exclusions.join(" ")).toContain("generated Orientation Context");
    expect(entries.get("inventory.txt")).toContain(
      "Included families: account profile, People, Contact Methods, Memories, Source Records, Interactions, Follow-Ups, Self Context",
    );
    expect(entries.get("inventory.txt")).toContain(
      "- resources/relationship/memories-v1.json, 1 record, sensitivity restricted",
    );
    const people = resource(entries, "resources/people/people-v1.json");
    expect(people).toEqual([
      expect.objectContaining({ id: "person-owned", ownerUserId: "owner-1" }),
    ]);
    expect(people[0]).not.toHaveProperty("searchVector");
    expect(resource(entries, "resources/people/contact-methods-v1.json")).toEqual([
      expect.objectContaining({ id: "contact-owned", personId: "person-owned" }),
    ]);
    const memories = resource(entries, "resources/relationship/memories-v1.json");
    expect(memories).toEqual([
      expect.objectContaining({
        id: "memory-owned-restricted",
        status: "dismissed",
        sensitivity: "restricted",
        sourceRecordId: "source-owned",
      }),
    ]);
    expect(memories[0]).not.toHaveProperty("searchVector");
    const sourceRecords = resource(entries, "resources/relationship/source-records-v1.json");
    expect(sourceRecords).toEqual([
      expect.objectContaining({
        id: "source-owned",
        status: "archived",
        sensitivity: "restricted",
      }),
    ]);
    expect(sourceRecords[0]).toMatchObject({ metadataJson: { captureSurface: "account" } });
    expect(sourceRecords[0]).not.toMatchObject({
      metadataJson: expect.objectContaining({
        discordHitlSessionId: expect.anything(),
        captureInputHash: expect.anything(),
        interactionId: expect.anything(),
      }),
    });
    expect(resource(entries, "resources/relationship/source-record-people-v1.json")).toEqual([
      expect.objectContaining({
        id: "source-person-owned",
        sourceRecordId: "source-owned",
        personId: "person-owned",
      }),
    ]);
    expect(resource(entries, "resources/relationship/unresolved-person-mentions-v1.json")).toEqual([
      expect.objectContaining({
        id: "mention-owned",
        sourceRecordId: "source-owned",
        candidatePersonIds: ["person-owned"],
        resolvedPersonId: "person-owned",
      }),
    ]);
    expect(resource(entries, "resources/relationship/interactions-v1.json")).toEqual([
      expect.objectContaining({ id: "interaction-owned", personId: "person-owned" }),
    ]);
    expect(resource(entries, "resources/relationship/follow-ups-v1.json")).toEqual([
      expect.objectContaining({
        id: "followup-owned-suggested",
        status: "suggested",
        sourceRecordId: "source-owned",
      }),
    ]);
    expect(resource(entries, "resources/context/context-facts-v1.json")).toEqual([
      expect.objectContaining({ id: "context-owned-suggested", lifecycle: "suggested" }),
    ]);

    const archiveText = new TextDecoder().decode(result.bytes);
    expect(archiveText).not.toContain("Grace Hopper");
    expect(archiveText).not.toContain("Other owner's");
    expect(archiveText).not.toContain("Household context must not be exported");
    expect(archiveText).not.toContain("provider raw payload must not be exported");
    expect(archiveText).not.toContain("PEOPLE_SEARCH_VECTOR_SENTINEL");
    expect(archiveText).not.toContain("MEMORIES_SEARCH_VECTOR_SENTINEL");
    expect(archiveText).not.toContain("DISCORD_HITL_SESSION_SENTINEL");
    expect(archiveText).not.toContain("CAPTURE_INPUT_HASH_SENTINEL");
    expect(archiveText).not.toContain("INTERACTION_ID_SENTINEL");
  });

  it("retains every supported lifecycle state in the portable resources", async () => {
    const context = relationshipContext();
    const sourceStatuses = ["pending_resolution", "active", "dismissed"] as const;
    context.sourceRecords.push(
      ...sourceStatuses.map((status) => ({
        ...first(context.sourceRecords),
        id: `source-lifecycle-${status}`,
        content: `Source record ${status}`,
        status,
      })),
    );
    const memoryStatuses = ["suggested", "approved", "archived"] as const;
    context.memories.push(
      ...memoryStatuses.map((status) => ({
        ...first(context.memories),
        id: `memory-lifecycle-${status}`,
        content: `Memory ${status}`,
        status,
        approvedAt: status === "approved" ? NOW : null,
        dismissedAt: null,
      })),
    );
    const followupStatuses = ["open", "snoozed", "completed", "dismissed", "archived"] as const;
    context.followups.push(
      ...followupStatuses.map((status) => ({
        ...first(context.followups),
        id: `followup-lifecycle-${status}`,
        reason: `Follow-up ${status}`,
        status,
      })),
    );
    const contextFactLifecycles = ["active", "archived"] as const;
    context.contextFacts.push(
      ...contextFactLifecycles.map((lifecycle) => ({
        ...first(context.contextFacts),
        id: `context-lifecycle-${lifecycle}`,
        content: `Context fact ${lifecycle}`,
        lifecycle,
      })),
    );

    const result = await generateOwnerDataExportArchive({
      ownerUserId: "owner-1",
      account: ACCOUNT,
      now: NOW,
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
      relationshipContext: context,
    });
    const entries = readStoredZipEntries(result.bytes);
    const statuses = <T extends { status: string }>(path: string) =>
      resource(entries, path)
        .map((record) => (record as T).status)
        .sort();

    expect(statuses("resources/relationship/memories-v1.json")).toEqual(
      ["suggested", "approved", "dismissed", "archived"].sort(),
    );
    expect(statuses("resources/relationship/source-records-v1.json")).toEqual(
      ["pending_resolution", "active", "dismissed", "archived"].sort(),
    );
    expect(statuses("resources/relationship/follow-ups-v1.json")).toEqual(
      ["suggested", "open", "snoozed", "completed", "dismissed", "archived"].sort(),
    );
    expect(
      resource(entries, "resources/context/context-facts-v1.json")
        .map((record) => (record as { lifecycle: string }).lifecycle)
        .sort(),
    ).toEqual(["suggested", "active", "archived"].sort());
  });

  it.each([
    "source-missing",
    "source-other-owner",
  ])("fails closed when an owner memory is grounded to %s", async (sourceRecordId) => {
    const context = relationshipContext();
    context.memories.push({
      ...first(context.memories),
      id: `memory-invalid-${sourceRecordId}`,
      sourceRecordId,
    });

    await expect(
      generateOwnerDataExportArchive({
        ownerUserId: "owner-1",
        account: ACCOUNT,
        now: NOW,
        expiresAt: new Date("2026-08-20T12:00:00.000Z"),
        relationshipContext: context,
      }),
    ).rejects.toThrow(`memory-invalid-${sourceRecordId}`);
  });
});
