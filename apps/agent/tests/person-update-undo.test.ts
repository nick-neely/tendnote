import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, toolModelValue } from "./test-tool";

const store = vi.hoisted(() => ({
  updatePerson: vi.fn(),
  undoPersonUpdate: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@tendnote/db/queries/people", () => store);
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation: store.reconcile,
}));
const updateTool = asTestTool((await import("../agent/tools/update_person")).default);
const undoTool = asTestTool((await import("../agent/tools/undo_person_update")).default);
const target = {
  personId: "11111111-1111-4111-8111-111111111111",
  updateId: "22222222-2222-4222-8222-222222222222",
};
const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;
beforeEach(() => vi.clearAllMocks());
describe("person update tool contract", () => {
  it("returns the authoritative target while minimizing model-facing old values", async () => {
    store.updatePerson.mockResolvedValue({
      result: {
        id: target.personId,
        displayName: "Mara",
        relationshipType: "friend",
        update: {
          target,
          changes: [{ field: "profileBlurb", before: "PRIVATE OLD VALUE", after: null }],
        },
      },
      affectedScopes: [],
    });
    const output = await updateTool.execute({ personId: target.personId, profileBlurb: null }, ctx);
    expect(output.update?.target).toEqual(target);
    expect(toolModelValue(updateTool, output).undoTarget).toEqual(target);
    expect(JSON.stringify(toolModelValue(updateTool, output))).not.toContain("PRIVATE OLD VALUE");
    expect(store.updatePerson).toHaveBeenCalledWith({
      personId: target.personId,
      ownerUserId: "owner-1",
      profileBlurb: null,
    });
  });
  it("does not claim an update for unchanged values", async () => {
    store.updatePerson.mockResolvedValue({
      result: { id: target.personId, update: null },
      affectedScopes: [],
    });
    expect(
      (await updateTool.execute({ personId: target.personId, displayName: "Mara" }, ctx)).updated,
    ).toBe(false);
  });
  it.each(["applied", "already_undone", "superseded", "unavailable"])(
    "reports %s exactly as the shared Undo answered",
    async (status) => {
      store.undoPersonUpdate.mockResolvedValue({ result: { status }, affectedScopes: [] });
      expect(await undoTool.execute(target, ctx)).toEqual({ status });
      expect(store.undoPersonUpdate).toHaveBeenCalledWith({ ...target, ownerUserId: "owner-1" });
    },
  );
});
