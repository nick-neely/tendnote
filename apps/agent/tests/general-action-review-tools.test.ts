import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSuggestedGeneralActionReviews: vi.fn(),
  getSuggestedGeneralActionReview: vi.fn(),
  acceptSuggestedGeneralAction: vi.fn(),
  dismissSuggestedGeneralAction: vi.fn(),
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
}));

vi.mock("@tendnote/db/queries/general-actions", () => mocks);
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation: mocks.requestBackgroundAffectedScopeReconciliation,
}));

const { default: listReviewsTool } = await import(
  "../agent/tools/list_suggested_general_action_reviews"
);
const { default: getReviewTool } = await import(
  "../agent/tools/get_suggested_general_action_review"
);
const { default: acceptTool } = await import("../agent/tools/accept_suggested_general_action");
const { default: dismissTool } = await import("../agent/tools/dismiss_suggested_general_action");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;
const ACTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

function suggested(overrides: Partial<GeneralActionWithContext> = {}): GeneralActionWithContext {
  return {
    id: ACTION_ID,
    ownerUserId: "user-1",
    ownership: "member_owned",
    responsibilityHolderUserId: null,
    occurrenceVersion: 0,
    title: "Book the campsite",
    notes: null,
    links: [],
    status: "suggested",
    dueAt: null,
    deferUntil: null,
    sourceRecordId: SOURCE_ID,
    areaId: null,
    scope: "private",
    householdId: null,
    assetHints: [],
    recurrence: null,
    createdByUserId: "user-1",
    lastActorUserId: "user-1",
    completedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    linkedPeople: [],
    sharedWithCount: 0,
    householdName: null,
    ...overrides,
  };
}

function reviewResult(action = suggested()) {
  return {
    action,
    sourceRecord: { id: SOURCE_ID },
    component: {
      type: "suggested_general_action_review" as const,
      generalActionId: action.id,
      sourceRecordId: SOURCE_ID,
    },
  };
}

function mutationOutcome<TResult>(result: TResult) {
  return {
    result,
    affectedScopes: [
      { kind: "owner-collection" as const, collection: "review" as const, ownerUserId: "user-1" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_suggested_general_action_reviews", () => {
  it("lists owner-scoped proposals as review components", async () => {
    mocks.listSuggestedGeneralActionReviews.mockResolvedValue([reviewResult()]);

    const result = await listReviewsTool.execute({}, ctx);

    expect(mocks.listSuggestedGeneralActionReviews).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      limit: undefined,
    });
    expect(result.count).toBe(1);
    expect(result.reviews[0]?.component.type).toBe("suggested_general_action_review");
    // The model view carries the persisted action id for accept/dismiss follow-ups.
    const model = listReviewsTool.toModelOutput?.(result as never) as { value: unknown };
    expect(JSON.stringify(model.value)).toContain(ACTION_ID);
  });
});

describe("get_suggested_general_action_review", () => {
  it("returns the proposal when it is still suggested", async () => {
    mocks.getSuggestedGeneralActionReview.mockResolvedValue(reviewResult());

    const result = await getReviewTool.execute({ generalActionId: ACTION_ID }, ctx);

    expect(result.found).toBe(true);
    expect(mocks.getSuggestedGeneralActionReview).toHaveBeenCalledWith({
      actorUserId: "user-1",
      generalActionId: ACTION_ID,
    });
  });

  it("returns found:false when the proposal is gone or resolved", async () => {
    mocks.getSuggestedGeneralActionReview.mockResolvedValue(null);

    const result = await getReviewTool.execute({ generalActionId: ACTION_ID }, ctx);

    expect(result.found).toBe(false);
    const model = getReviewTool.toModelOutput?.(result as never) as { value: { found: boolean } };
    expect(model.value.found).toBe(false);
  });
});

describe("accept_suggested_general_action — only promotes on explicit approval", () => {
  it("promotes a proposal to an active action, applying an optional edit", async () => {
    mocks.acceptSuggestedGeneralAction.mockResolvedValue(
      mutationOutcome(
        reviewResult(suggested({ status: "open", title: "Book the lakeside campsite" })),
      ),
    );

    const result = await acceptTool.execute(
      {
        generalActionId: ACTION_ID,
        edit: { title: "Book the lakeside campsite", dueAt: "2026-08-01" },
      },
      ctx,
    );

    const passed = mocks.acceptSuggestedGeneralAction.mock.calls[0]?.[0];
    expect(passed.actorUserId).toBe("user-1");
    expect(passed.edit.title).toBe("Book the lakeside campsite");
    expect(passed.edit.dueAt).toBeInstanceOf(Date);
    expect(result.action.status).toBe("open");
    expect(mocks.requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([
      { kind: "owner-collection", collection: "review", ownerUserId: "user-1" },
    ]);
  });

  it("accepts with no edit when the proposal is approved as-is", async () => {
    mocks.acceptSuggestedGeneralAction.mockResolvedValue(
      mutationOutcome(reviewResult(suggested({ status: "open" }))),
    );

    await acceptTool.execute({ generalActionId: ACTION_ID }, ctx);

    const passed = mocks.acceptSuggestedGeneralAction.mock.calls[0]?.[0];
    expect(passed.edit).toBeUndefined();
  });
});

describe("dismiss_suggested_general_action", () => {
  it("dismisses a proposal without promoting it", async () => {
    mocks.dismissSuggestedGeneralAction.mockResolvedValue(
      mutationOutcome(suggested({ status: "dismissed" })),
    );

    const result = await dismissTool.execute({ generalActionId: ACTION_ID }, ctx);

    expect(mocks.dismissSuggestedGeneralAction).toHaveBeenCalledWith({
      actorUserId: "user-1",
      generalActionId: ACTION_ID,
    });
    expect(result.action.status).toBe("dismissed");
  });
});
