import { HouseholdRecordUnavailableError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const { listGiftPlans, searchGiftPlans, addGiftIdea } = vi.hoisted(() => ({
  listGiftPlans: vi.fn(),
  searchGiftPlans: vi.fn(),
  addGiftIdea: vi.fn(),
}));
vi.mock("@tendnote/db/queries/gift-plans", () => ({
  listGiftPlans,
  searchGiftPlans,
  addGiftIdea,
}));

const { requestBackgroundAffectedScopeReconciliation } = vi.hoisted(() => ({
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawSearchTool } = await import("../agent/tools/search_gift_plans");
const { default: rawAddTool } = await import("../agent/tools/add_gift_idea");
const searchTool = asTestTool(rawSearchTool);
const addTool = asTestTool(rawAddTool);

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    ownerUserId: "user-1",
    subjectName: "Rowan",
    occasion: "Fortieth birthday",
    occasionOn: new Date("2026-09-14T00:00:00.000Z"),
    status: "active",
    scope: "shared",
    householdId: "household-1",
    subjectPersonId: null,
    surpriseSubjectUserId: "user-9",
    householdName: "Home",
    sharedWithUserIds: ["user-2"],
    ideaCount: 2,
    claimedIdeaCount: 1,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("search_gift_plans", () => {
  it("asks the seam with the caller's own id and no household or audience argument", async () => {
    searchGiftPlans.mockResolvedValue([plan()]);

    await searchTool.execute({ query: "Rowan" }, ctx);

    // The whole safety property of the tool: the only identity it can name is the
    // session's, and there is no argument shape that widens the read.
    expect(searchGiftPlans).toHaveBeenCalledWith({
      callerUserId: "user-1",
      query: "Rowan",
      limit: undefined,
    });
    expect(listGiftPlans).not.toHaveBeenCalled();
  });

  it("lists everything visible when no query is given", async () => {
    listGiftPlans.mockResolvedValue([]);

    await searchTool.execute({}, ctx);

    expect(listGiftPlans).toHaveBeenCalledWith({ callerUserId: "user-1", limit: undefined });
    expect(searchGiftPlans).not.toHaveBeenCalled();
  });

  it("hands the model no audience, no subject flag, and no co-planner", async () => {
    searchGiftPlans.mockResolvedValue([plan()]);

    const output = await searchTool.execute({ query: "Rowan" }, ctx);
    const model = searchTool.toModelOutput?.(output) as {
      value: { count: number; plans: unknown[] };
    };
    // The rows only. `guidance` is a standing instruction that names the failure
    // modes on purpose ("do not mention surprises"), and asserting over it would
    // be asserting that the tool never says what it must say.
    const serialized = JSON.stringify(model.value.plans);

    // A protected plan is absent for the person it protects against; for everyone
    // else it must not carry the shape of the protection either. Naming the
    // Surprise Subject, or the other co-planners, would let the model narrate a
    // roster the plan is not — and would put the subject's id in Eve's context.
    expect(serialized).not.toContain("user-9");
    expect(serialized).not.toContain("user-2");
    expect(serialized).not.toContain("surprise");
    expect(serialized).not.toContain("household-1");
    expect(model.value).toMatchObject({
      count: 1,
      plans: [{ forWhom: "Rowan", occasion: "Fortieth birthday", ideas: 2, claimed: 1 }],
    });
  });

  it("reports an empty result as empty, with nothing for the model to hedge from", async () => {
    // What a Surprise Subject sees. It must be byte-identical to what someone with
    // no plans at all sees: no count of hidden rows, no limitation, no reason.
    searchGiftPlans.mockResolvedValue([]);

    const output = await searchTool.execute({ query: "Rowan" }, ctx);
    const model = searchTool.toModelOutput?.(output) as {
      value: { count: number; plans: unknown[] };
    };

    expect(model.value).toMatchObject({ count: 0, plans: [] });
    // Not "0 of 2 shown", not a limitation, not a placeholder: an empty list and
    // a zero, which is exactly what a user with no plans at all receives.
    expect(JSON.stringify(model.value.plans)).toBe("[]");
    expect(model.value.count).toBe(0);
  });
});

describe("add_gift_idea", () => {
  it("attributes the idea to the session's caller and reconciles the plan's readers", async () => {
    addGiftIdea.mockResolvedValue({
      result: { id: "idea-1", title: "Wool scarf" },
      affectedScopes: [{ kind: "viewer-collection", collection: "gift-plans", viewerUserId: "u" }],
    });

    const output = await addTool.execute(
      { giftPlanId: "11111111-1111-4111-8111-111111111111", title: "Wool scarf" },
      ctx,
    );

    expect(addGiftIdea).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "user-1", title: "Wool scarf" }),
    );
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([
      { kind: "viewer-collection", collection: "gift-plans", viewerUserId: "u" },
    ]);
    expect(output.added).toBe(true);
  });

  it("passes the seam's one opaque refusal through unchanged", async () => {
    // The refusal a Surprise Subject gets when they try to add to their own
    // surprise, and the one an outsider gets, and the one a deleted plan gets.
    // They must reach the model as the same sentence, which names nothing.
    addGiftIdea.mockRejectedValue(new HouseholdRecordUnavailableError());

    await expect(
      addTool.execute(
        { giftPlanId: "11111111-1111-4111-8111-111111111111", title: "Wool scarf" },
        ctx,
      ),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});
