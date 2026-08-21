import { HouseholdRecordUnavailableError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GIFT_PLAN_EMPTY_REPLY_CANONICAL } from "../agent/lib/response-contracts";
import { asTestTool, toolModelValue } from "./test-tool";

const {
  listGiftPlans,
  searchGiftPlans,
  getGiftPlanDetail,
  addGiftIdea,
  editGiftIdea,
  removeGiftIdea,
} = vi.hoisted(() => ({
  listGiftPlans: vi.fn(),
  searchGiftPlans: vi.fn(),
  getGiftPlanDetail: vi.fn(),
  addGiftIdea: vi.fn(),
  editGiftIdea: vi.fn(),
  removeGiftIdea: vi.fn(),
}));
vi.mock("@tendnote/db/queries/gift-plans", () => ({
  listGiftPlans,
  searchGiftPlans,
  getGiftPlanDetail,
  addGiftIdea,
  editGiftIdea,
  removeGiftIdea,
}));

const { requestBackgroundAffectedScopeReconciliation } = vi.hoisted(() => ({
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawSearchTool } = await import("../agent/tools/search_gift_plans");
const { default: rawGetTool } = await import("../agent/tools/get_gift_plan");
const { default: rawAddTool } = await import("../agent/tools/add_gift_idea");
const { default: rawEditTool } = await import("../agent/tools/edit_gift_idea");
const { default: rawRemoveTool } = await import("../agent/tools/remove_gift_idea");
const searchTool = asTestTool(rawSearchTool);
const getTool = asTestTool(rawGetTool);
const addTool = asTestTool(rawAddTool);
const editTool = asTestTool(rawEditTool);
const removeTool = asTestTool(rawRemoveTool);

// The session and its turn travel because `add_gift_idea` derives its retry key from
// them; nothing else in these tools reads them.
const ctx = {
  session: {
    id: "session-1",
    turn: { id: "turn-1", sequence: 0 },
    auth: { current: { principalId: "user-1" } },
  },
} as never;
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const IDEA_ID = "22222222-2222-4222-8222-222222222222";

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
      value: { count: number; plans: unknown[]; requiredResponse: string; guidance: string };
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
      value: {
        count: number;
        plans: unknown[];
        requiredResponse: string | null;
        guidance: string;
      };
    };

    expect(model.value).toMatchObject({ count: 0, plans: [] });
    // Not "0 of 2 shown", not a limitation, not a placeholder: an empty list and
    // a zero, which is exactly what a user with no plans at all receives.
    expect(JSON.stringify(model.value.plans)).toBe("[]");
    expect(model.value.count).toBe(0);
    expect(model.value.requiredResponse).toBe(GIFT_PLAN_EMPTY_REPLY_CANONICAL);
    expect(model.value.guidance).toMatch(/exactly and add nothing else/i);
    expect(model.value.guidance).toMatch(/do not qualify|speculate/i);
  });
});

describe("add_gift_idea", () => {
  it("attributes the idea to the session's caller and reconciles the plan's readers", async () => {
    addGiftIdea.mockResolvedValue({
      result: { id: IDEA_ID, title: "Wool scarf" },
      decision: "created",
      affectedScopes: [{ kind: "viewer-collection", collection: "gift-plans", viewerUserId: "u" }],
    });

    const output = await addTool.execute({ giftPlanId: PLAN_ID, title: "Wool scarf" }, ctx);

    expect(addGiftIdea).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "user-1", title: "Wool scarf" }),
    );
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([
      { kind: "viewer-collection", collection: "gift-plans", viewerUserId: "u" },
    ]);
    expect(output.added).toBe(true);
  });

  it("keys the write to this turn and these words, so a retry adds one idea", async () => {
    // Derived from the session, not asked for: a key the model supplies is a key it can
    // vary on the very retry the key exists to suppress. Same turn + same title is the
    // repeat; a different title in the same turn is a different idea.
    addGiftIdea.mockResolvedValue({
      result: { id: IDEA_ID, title: "Wool scarf" },
      decision: "created",
      affectedScopes: [],
    });

    await addTool.execute({ giftPlanId: PLAN_ID, title: "Wool scarf" }, ctx);

    expect(addGiftIdea).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "eve:session-1:turn-1:wool scarf" }),
    );
  });

  it("gives the model the idea's own handle so a correction is reachable", async () => {
    addGiftIdea.mockResolvedValue({
      result: { id: IDEA_ID, title: "Wool scarf" },
      decision: "created",
      affectedScopes: [],
    });

    const output = await addTool.execute({ giftPlanId: PLAN_ID, title: "Wool scarf" }, ctx);
    const value = toolModelValue(addTool, output);

    // `edit_gift_idea` and `remove_gift_idea` take one, and this is the only place it
    // can enter the model's context. The plan's audience still travels nowhere.
    expect(value.giftIdeaId).toBe(IDEA_ID);
    expect(JSON.stringify(value)).not.toContain(PLAN_ID);
  });

  it("passes the seam's one opaque refusal through unchanged", async () => {
    // The refusal a Surprise Subject gets when they try to add to their own
    // surprise, and the one an outsider gets, and the one a deleted plan gets.
    // They must reach the model as the same sentence, which names nothing.
    addGiftIdea.mockRejectedValue(new HouseholdRecordUnavailableError());

    await expect(
      addTool.execute({ giftPlanId: PLAN_ID, title: "Wool scarf" }, ctx),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});

describe("edit_gift_idea", () => {
  it("edits as the session's caller, passing only the fields that changed", async () => {
    editGiftIdea.mockResolvedValue({
      result: { id: IDEA_ID, title: "Cashmere scarf" },
      affectedScopes: [{ kind: "viewer-collection", collection: "gift-plans", viewerUserId: "u" }],
    });

    await editTool.execute({ giftIdeaId: IDEA_ID, title: "Cashmere scarf" }, ctx);

    expect(editGiftIdea).toHaveBeenCalledWith({
      actorUserId: "user-1",
      giftIdeaId: IDEA_ID,
      edit: { title: "Cashmere scarf" },
    });
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([
      { kind: "viewer-collection", collection: "gift-plans", viewerUserId: "u" },
    ]);
  });

  it("refuses an edit that changes nothing rather than confirming one", async () => {
    await expect(editTool.execute({ giftIdeaId: IDEA_ID }, ctx)).rejects.toThrow(
      /Say what to change/,
    );
    expect(editGiftIdea).not.toHaveBeenCalled();
  });

  it("passes the same opaque refusal through for someone else's idea", async () => {
    // Contributorship is asserted by the domain, and a Surprise Subject is refused at
    // the same gate as a read - one sentence, naming nothing (ADR 0216).
    editGiftIdea.mockRejectedValue(new HouseholdRecordUnavailableError());

    await expect(
      editTool.execute({ giftIdeaId: IDEA_ID, title: "Not yours" }, ctx),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});

describe("remove_gift_idea", () => {
  it("removes as the session's caller and reconciles the plan's readers", async () => {
    removeGiftIdea.mockResolvedValue({
      result: { giftIdeaId: IDEA_ID },
      affectedScopes: [{ kind: "viewer-collection", collection: "gift-plans", viewerUserId: "u" }],
    });

    const output = await removeTool.execute({ giftIdeaId: IDEA_ID }, ctx);

    expect(removeGiftIdea).toHaveBeenCalledWith({ actorUserId: "user-1", giftIdeaId: IDEA_ID });
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([
      { kind: "viewer-collection", collection: "gift-plans", viewerUserId: "u" },
    ]);
    expect(output.removed).toBe(true);
  });

  it("tells the model it is gone without handing back the idea or an id", async () => {
    removeGiftIdea.mockResolvedValue({ result: { giftIdeaId: IDEA_ID }, affectedScopes: [] });

    const output = await removeTool.execute({ giftIdeaId: IDEA_ID }, ctx);
    const value = toolModelValue(removeTool, output);

    expect(value.removed).toBe(true);
    expect(JSON.stringify(value)).not.toContain(IDEA_ID);
  });

  it("passes the seam's one opaque refusal through unchanged", async () => {
    removeGiftIdea.mockRejectedValue(new HouseholdRecordUnavailableError());

    await expect(removeTool.execute({ giftIdeaId: IDEA_ID }, ctx)).rejects.toBeInstanceOf(
      HouseholdRecordUnavailableError,
    );
    expect(requestBackgroundAffectedScopeReconciliation).not.toHaveBeenCalled();
  });
});

/**
 * The read that made `edit_gift_idea` and `remove_gift_idea` usable at all.
 *
 * `search_gift_plans` returns counts, not ideas, so the only `giftIdeaId` in Eve's
 * context was the one `add_gift_idea` had just minted. "Actually make that the
 * cashmere one" worked a minute after adding and was unanswerable the next morning.
 */
describe("get_gift_plan", () => {
  function idea(overrides: Record<string, unknown> = {}) {
    return {
      id: IDEA_ID,
      giftPlanId: "plan-1",
      contributorUserId: "user-1",
      title: "Wool scarf",
      note: "Navy, from the market",
      url: null,
      claimedByUserId: null,
      claimedAt: null,
      lastActorUserId: null,
      revision: 0,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("asks the seam with the caller's own id and no household or audience argument", async () => {
    getGiftPlanDetail.mockResolvedValue({ plan: plan(), ideas: [idea()], events: [] });

    await getTool.execute({ giftPlanId: PLAN_ID, limit: 20 }, ctx);

    // The whole safety property: the only identity it can name is the session's, and
    // there is no argument shape that widens the read.
    expect(getGiftPlanDetail).toHaveBeenCalledWith({
      callerUserId: "user-1",
      giftPlanId: PLAN_ID,
    });
  });

  it("hands the model the idea handles its edit and remove tools require", async () => {
    getGiftPlanDetail.mockResolvedValue({ plan: plan(), ideas: [idea()], events: [] });

    const output = await getTool.execute({ giftPlanId: PLAN_ID, limit: 20 }, ctx);
    const value = toolModelValue(getTool, output) as {
      ideas: Array<{ giftIdeaId: string; addedByCaller: boolean; claimed: boolean }>;
    };

    // Without this the two mutation tools are unreachable across sessions, which is
    // the entire reason this tool exists.
    expect(value.ideas[0]?.giftIdeaId).toBe(IDEA_ID);
    expect(value.ideas[0]?.addedByCaller).toBe(true);
    expect(value.ideas[0]?.claimed).toBe(false);
  });

  it("says an idea is claimed without saying by whom, and names no co-planner", async () => {
    getGiftPlanDetail.mockResolvedValue({
      plan: plan(),
      ideas: [idea({ contributorUserId: "user-2", claimedByUserId: "user-2" })],
      events: [{ id: "event-1", kind: "idea_claimed", actorUserId: "user-2" }],
    });

    const output = await getTool.execute({ giftPlanId: PLAN_ID, limit: 20 }, ctx);
    const value = toolModelValue(getTool, output) as {
      ideas: Array<{ claimed: boolean; claimedByCaller: boolean; addedByCaller: boolean }>;
    };
    const serialized = JSON.stringify(value.ideas);

    // A claim stops two co-planners buying the same scarf; the claimer's name is
    // gossip about a household. Neither the audience nor the event log travels.
    expect(value.ideas[0]?.claimed).toBe(true);
    expect(value.ideas[0]?.claimedByCaller).toBe(false);
    expect(value.ideas[0]?.addedByCaller).toBe(false);
    expect(serialized).not.toContain("user-2");
    expect(serialized).not.toContain("user-9");
    expect(serialized).not.toContain("event-1");
    expect(JSON.stringify(value)).not.toContain("surprise");
  });

  /**
   * The Surprise Subject case. The seam refuses at the `view` proof and answers
   * `null`, which must reach the model as the same nothing a stranger gets: no
   * count, no title, no hedge, and no invitation to retry with another id.
   */
  it("reports a refused plan as absent, byte-identically to one that does not exist", async () => {
    getGiftPlanDetail.mockResolvedValue(null);

    const output = await getTool.execute({ giftPlanId: PLAN_ID, limit: 20 }, ctx);
    const value = toolModelValue(getTool, output);

    expect(output.found).toBe(false);
    expect(value.found).toBe(false);
    expect(Object.keys(value).sort()).toEqual(["found", "guidance"]);
    expect(value.guidance).toMatch(/do not say it might exist/i);
    expect(value.guidance).toMatch(/do not retry/i);
    expect(JSON.stringify(value)).not.toContain("Rowan");
  });

  it("bounds the ideas it returns and says so when it truncated", async () => {
    getGiftPlanDetail.mockResolvedValue({
      plan: plan(),
      ideas: [idea(), idea({ id: "22222222-2222-4222-8222-222222222223" })],
      events: [],
    });

    const output = await getTool.execute({ giftPlanId: PLAN_ID, limit: 1 }, ctx);
    const value = toolModelValue(getTool, output) as {
      count: number;
      truncated: boolean;
      guidance: string;
    };

    expect(value.count).toBe(1);
    expect(value.truncated).toBe(true);
    expect(value.guidance).toMatch(/more ideas are on the plan/i);
  });

  it("passes the seam's one opaque refusal through unchanged", async () => {
    getGiftPlanDetail.mockRejectedValue(new HouseholdRecordUnavailableError());

    await expect(getTool.execute({ giftPlanId: PLAN_ID, limit: 20 }, ctx)).rejects.toBeInstanceOf(
      HouseholdRecordUnavailableError,
    );
  });
});
