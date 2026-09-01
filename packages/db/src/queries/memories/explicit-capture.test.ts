import { parseExplicitMemoryRequest } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryMemoryStore, createMemoryCapture } from "../memories";

async function seedPerson(
  store: ReturnType<typeof createInMemoryMemoryStore>,
  overrides: { ownerUserId?: string; displayName?: string } = {},
) {
  return store.createPerson({
    ownerUserId: overrides.ownerUserId ?? "user-1",
    displayName: overrides.displayName ?? "Caleb",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });
}

describe("explicit memory capture", () => {
  it("creates one approved Memory against existing Capture evidence and is retry-safe", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store);
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: "user-1",
      sourceType: "manual",
      content: "Remember that Caleb prefers texts",
      scope: "private",
    });

    const first = await capture.captureExplicitMemoryFromSource({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb prefers texts",
      sourceRecordId: sourceRecord.id,
    });
    const retry = await capture.captureExplicitMemoryFromSource({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb prefers texts",
      sourceRecordId: sourceRecord.id,
    });

    expect(first.memory).toMatchObject({
      personId: caleb.id,
      sourceRecordId: sourceRecord.id,
      content: "Caleb prefers texts",
      status: "approved",
      scope: "private",
    });
    expect(retry.memory.id).toBe(first.memory.id);
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toHaveLength(1);
  });

  it("creates a source record and an approved memory that references it", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store);

    const result = await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });

    expect(result.sourceRecord).toMatchObject({
      ownerUserId: "user-1",
      content: "Caleb is moving to Denver in August",
      sourceType: "manual",
      status: "active",
      scope: "private",
      metadataJson: { capturedVia: "explicit_memory" },
    });
    expect(result.memory).toMatchObject({
      ownerUserId: "user-1",
      personId: caleb.id,
      sourceRecordId: result.sourceRecord.id,
      content: "Caleb is moving to Denver in August",
      status: "approved",
      sensitivity: "normal",
      confidence: "medium",
      importance: 3,
      scope: "private",
    });
    expect(result.memory.approvedAt).toBeInstanceOf(Date);
  });

  it("links the source record to the resolved person as the primary subject", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store);

    const result = await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });

    await expect(
      store.listSourceRecordPeople({ sourceRecordId: result.sourceRecord.id }),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceRecordId: result.sourceRecord.id,
        personId: caleb.id,
        role: "primary",
      }),
    ]);
  });

  it("keeps source-record provenance: the approved memory always points at a real source record", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store);

    const result = await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb prefers texts over calls",
    });

    expect(result.memory.sourceRecordId).toBe(result.sourceRecord.id);
    await expect(
      store.getSourceRecord({
        ownerUserId: "user-1",
        sourceRecordId: result.memory.sourceRecordId,
      }),
    ).resolves.not.toBeNull();
  });

  it("ties the approved memory to the correct owner and rejects another owner's person", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store, { ownerUserId: "user-1" });

    await expect(
      capture.captureExplicitMemory({
        ownerUserId: "user-2",
        personId: caleb.id,
        content: "Trying to write to someone else's person",
      }),
    ).rejects.toThrow("Person not found.");
  });

  it("rejects empty memory content", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store);

    await expect(
      capture.captureExplicitMemory({
        ownerUserId: "user-1",
        personId: caleb.id,
        content: "   ",
      }),
    ).rejects.toThrow("Explicit memory content is required.");
  });

  it("writes audit log entries for both the source record and the approved memory", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store);

    const result = await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });

    const auditEntries = await store.listAuditLogEntries({ ownerUserId: "user-1" });

    expect(auditEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "source_record.capture",
          entityType: "source_record",
          entityId: result.sourceRecord.id,
        }),
        expect.objectContaining({
          action: "memory.capture_explicit",
          entityType: "memory",
          entityId: result.memory.id,
          metadataJson: {
            personId: caleb.id,
            sourceRecordId: result.sourceRecord.id,
            status: "approved",
          },
        }),
      ]),
    );
  });

  it("schedules approved-memory embedding work without embedding synchronously", async () => {
    const store = createInMemoryMemoryStore();
    const scheduled: Array<{ ownerUserId: string; recordKind: "memory"; recordId: string }> = [];
    const capture = createMemoryCapture(store, {
      async scheduleApprovedMemoryEmbedding(input) {
        scheduled.push(input);
      },
    });
    const caleb = await seedPerson(store);

    const result = await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });

    expect(scheduled).toEqual([
      {
        ownerUserId: "user-1",
        recordKind: "memory",
        recordId: result.memory.id,
      },
    ]);
  });

  it("honors a manual sensitivity override (ADR 0056)", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store);

    const result = await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is going through a tough divorce",
      sensitivity: "restricted",
    });

    expect(result.memory.sensitivity).toBe("restricted");
    expect(result.sourceRecord.sensitivity).toBe("restricted");
  });

  it.each(["remember", "save", "note", "keep track of"])(
    "captures an explicit '%s' request through the parse + capture path",
    async (trigger) => {
      const store = createInMemoryMemoryStore();
      const capture = createMemoryCapture(store);
      const caleb = await seedPerson(store);

      const parsed = parseExplicitMemoryRequest(`${trigger} Caleb just started a new job`);
      expect(parsed.isExplicitMemoryRequest).toBe(true);

      const result = await capture.captureExplicitMemory({
        ownerUserId: "user-1",
        personId: caleb.id,
        content: parsed.content,
      });

      expect(result.memory.status).toBe("approved");
      expect(result.memory.content).toBe("Caleb just started a new job");
      expect(result.memory.sourceRecordId).toBe(result.sourceRecord.id);
    },
  );
});
