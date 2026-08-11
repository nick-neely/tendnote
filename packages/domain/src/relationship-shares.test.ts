import { describe, expect, it } from "vitest";
import { householdOperationSchema } from "./household-authorization";
import {
  RELATIONSHIP_RECORD_NOUN,
  relationshipRecordKindSchema,
  relationshipShareGrants,
  requiresRestrictedShareConfirmation,
  restrictedShareConfirmationMessage,
  restrictedShareConfirmationPrompt,
  toSharedRelationshipRecordView,
} from "./relationship-shares";

/**
 * The exact field list a share recipient may receive. Written out here rather
 * than imported from the module under test on purpose: if this list and the
 * builder are the same constant, a leak can be "fixed" by widening the
 * constant, and the boundary stops being a boundary.
 */
const ALLOWED_VIEW_KEYS = [
  "audience",
  "body",
  "dueAt",
  "personLabel",
  "recordId",
  "recordKind",
  "recordedAt",
  "sharedByName",
  "trust",
  "viewerIsOwner",
];

function memoryInput() {
  return {
    recordKind: "memory" as const,
    recordId: "memory-1",
    body: "Prefers tea over coffee.",
    recordedAt: new Date("2026-05-01T00:00:00Z"),
    trust: "high" as const,
    personLabel: "Ada",
    sharedByName: "Mara",
    audience: "whole_household" as const,
    viewerIsOwner: false,
  };
}

describe("relationship record kinds", () => {
  it("covers exactly the three member-owned relationship records", () => {
    expect(relationshipRecordKindSchema.options).toEqual(["memory", "source_record", "followup"]);
  });

  it("names every kind for display", () => {
    for (const kind of relationshipRecordKindSchema.options) {
      expect(RELATIONSHIP_RECORD_NOUN[kind].length).toBeGreaterThan(0);
    }
  });
});

describe("relationshipShareGrants", () => {
  it("grants reading and nothing else", () => {
    const granted = householdOperationSchema.options.filter((operation) =>
      relationshipShareGrants(operation),
    );
    expect(granted).toEqual(["view"]);
  });
});

describe("toSharedRelationshipRecordView", () => {
  it("emits only the fields a recipient is allowed to receive", () => {
    const view = toSharedRelationshipRecordView(memoryInput());
    expect(Object.keys(view).sort()).toEqual(ALLOWED_VIEW_KEYS);
  });

  it("drops every private field the caller happens to pass through", () => {
    const view = toSharedRelationshipRecordView({
      ...memoryInput(),
      // Everything below is real column data on a memory row. None of it may
      // survive into a recipient's view.
      personId: "person-1",
      ownerUserId: "owner-1",
      sourceRecordId: "source-1",
      sensitivity: "restricted",
      importance: 5,
      householdId: "household-1",
      status: "approved",
    } as Parameters<typeof toSharedRelationshipRecordView>[0]);

    const serialized = JSON.stringify(view);
    for (const secret of [
      "person-1",
      "owner-1",
      "source-1",
      "restricted",
      "household-1",
      "approved",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(view).sort()).toEqual(ALLOWED_VIEW_KEYS);
  });

  it("never labels a shared Source Record with a person", () => {
    const view = toSharedRelationshipRecordView({
      ...memoryInput(),
      recordKind: "source_record",
      personLabel: "Ada",
    });
    expect(view.personLabel).toBeNull();
  });

  it("carries the deliberately exposed label for a memory and a follow-up", () => {
    expect(toSharedRelationshipRecordView(memoryInput()).personLabel).toBe("Ada");
    expect(
      toSharedRelationshipRecordView({ ...memoryInput(), recordKind: "followup" }).personLabel,
    ).toBe("Ada");
  });

  it("normalizes absent optional facts to null rather than omitting them", () => {
    const view = toSharedRelationshipRecordView({
      recordKind: "source_record",
      recordId: "source-1",
      body: "Coffee on Tuesday.",
      recordedAt: new Date("2026-05-01T00:00:00Z"),
      sharedByName: "Mara",
      audience: "selected_members",
      viewerIsOwner: false,
    });
    expect(view.personLabel).toBeNull();
    expect(view.trust).toBeNull();
    expect(view.dueAt).toBeNull();
  });
});

describe("restricted sharing confirmation", () => {
  it("is required only when restricted content actually leaves the owner", () => {
    expect(
      requiresRestrictedShareConfirmation({ sensitivity: "restricted", scope: "household" }),
    ).toBe(true);
    expect(
      requiresRestrictedShareConfirmation({ sensitivity: "restricted", scope: "shared" }),
    ).toBe(true);
    expect(
      requiresRestrictedShareConfirmation({ sensitivity: "restricted", scope: "private" }),
    ).toBe(false);
    expect(
      requiresRestrictedShareConfirmation({ sensitivity: "sensitive", scope: "household" }),
    ).toBe(false);
    expect(requiresRestrictedShareConfirmation({ sensitivity: "normal", scope: "household" })).toBe(
      false,
    );
  });

  it("names the whole household and says every active member can read it", () => {
    const prompt = restrictedShareConfirmationPrompt({
      recordKind: "memory",
      scope: "household",
      householdName: "Rivera House",
      audienceNames: [],
    });
    expect(prompt).toContain("Rivera House");
    expect(prompt).toContain("Every active member");
    expect(prompt).toContain("read");
  });

  it("names each selected member", () => {
    const prompt = restrictedShareConfirmationPrompt({
      recordKind: "followup",
      scope: "shared",
      householdName: "Rivera House",
      audienceNames: ["Mara", "Jon", "Sam"],
    });
    expect(prompt).toContain("Mara, Jon, and Sam");
    expect(prompt).toContain("read");
  });

  it("joins one and two names without a stray comma", () => {
    const one = restrictedShareConfirmationPrompt({
      recordKind: "memory",
      scope: "shared",
      householdName: "Rivera House",
      audienceNames: ["Mara"],
    });
    expect(one).toContain("Mara will");
    const two = restrictedShareConfirmationPrompt({
      recordKind: "memory",
      scope: "shared",
      householdName: "Rivera House",
      audienceNames: ["Mara", "Jon"],
    });
    expect(two).toContain("Mara and Jon");
    expect(two).not.toContain(",");
  });

  it("asks for confirmation in the record's own words", () => {
    expect(restrictedShareConfirmationMessage("memory")).toContain("memory");
    expect(restrictedShareConfirmationMessage("source_record")).toContain("note");
    expect(restrictedShareConfirmationMessage("followup")).toContain("follow-up");
  });
});
