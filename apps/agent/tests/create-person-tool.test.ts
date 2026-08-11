import { describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const { createPerson, reconcile } = vi.hoisted(() => ({
  createPerson: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@tendnote/db/queries/people", () => ({ createPerson }));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation: reconcile,
}));

const { default: rawTool } = await import("../agent/tools/create_person");
const tool = asTestTool(rawTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function createdPerson(overrides: Record<string, unknown> = {}) {
  return {
    id: "person-9",
    ownerUserId: "user-1",
    displayName: "Mara Lin",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
    createdAt: new Date("2026-06-25T00:00:00Z"),
    updatedAt: new Date("2026-06-25T00:00:00Z"),
    ...overrides,
  };
}

describe("create_person tool (explicit add-person intent)", () => {
  it("creates a person through the shared owner-scoped mutation and returns a persisted reference", async () => {
    const affectedScopes = [
      { kind: "owner-collection", collection: "people", ownerUserId: "user-1" },
    ];
    createPerson.mockResolvedValue({ result: createdPerson(), affectedScopes });

    const result = await tool.execute({ displayName: "Mara Lin", relationshipType: "friend" }, ctx);

    expect(createPerson).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        displayName: "Mara Lin",
        relationshipType: "friend",
      }),
    );
    expect(result.person.id).toBe("person-9");
    expect(result.person.displayName).toBe("Mara Lin");
    expect(result.component).toEqual({ type: "person_created", personId: "person-9" });
    expect(reconcile).toHaveBeenCalledWith(affectedScopes);
  });
});
