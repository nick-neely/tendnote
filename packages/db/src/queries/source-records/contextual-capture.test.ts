import { describe, expect, it } from "vitest";
import { createInMemorySourceRecordStore, createSourceRecordResolution } from "../source-records";

const OWNER = "user-1";

async function setup() {
  const store = createInMemorySourceRecordStore();
  const resolution = createSourceRecordResolution(store);

  const person = await store.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  return { store, resolution, person };
}

describe("context-aware source record capture", () => {
  it("saves a source record linked to a known person in one step", async () => {
    const { store, resolution, person } = await setup();

    const result = await resolution.captureSourceRecordForPerson({
      ownerUserId: OWNER,
      personId: person.id,
      retainedContent: "Mark mentioned a new role at lunch.",
    });

    expect(result.sourceRecord.status).toBe("active");
    expect(result.person.id).toBe(person.id);
    expect(result.component).toEqual({
      type: "source_record_review",
      sourceRecordId: result.sourceRecord.id,
    });

    const links = await store.listSourceRecordPeople({ sourceRecordId: result.sourceRecord.id });
    expect(links).toEqual([expect.objectContaining({ personId: person.id, role: "primary" })]);

    // The linked record is now reachable as that person's logged context.
    const context = await store.listSourceRecordsForPersonContext({
      ownerUserId: OWNER,
      personId: person.id,
    });
    expect(context.map((record) => record.id)).toContain(result.sourceRecord.id);
  });

  it("writes audit entries for capture and resolution", async () => {
    const { store, resolution, person } = await setup();

    await resolution.captureSourceRecordForPerson({
      ownerUserId: OWNER,
      personId: person.id,
      retainedContent: "Coffee with Mark.",
    });

    const actions = (await store.listAuditLogEntries({ ownerUserId: OWNER })).map(
      (entry) => entry.action,
    );
    expect(actions).toContain("source_record.capture");
    expect(actions).toContain("source_record.resolve_person");
  });

  it("rejects linking to an unknown person", async () => {
    const { resolution } = await setup();

    await expect(
      resolution.captureSourceRecordForPerson({
        ownerUserId: OWNER,
        personId: "00000000-0000-0000-0000-000000000000",
        retainedContent: "Note about a stranger.",
      }),
    ).rejects.toThrow();
  });
});
