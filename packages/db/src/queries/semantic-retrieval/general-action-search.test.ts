import type { HouseholdMembership } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createHarness, EMBEDDING_CONFIG, OTHER_OWNER, OWNER } from "./harness";
import { createSemanticRetrievalQueries } from "./queries";
import type { EmbeddingAdapter } from "./types";

const householdId = "99999999-9999-4999-8999-999999999999";

// Distinct vectors per theme so a query only matches actions on the same topic.
const vectorAdapter: EmbeddingAdapter = {
  async embedText(input) {
    const lower = input.text.toLowerCase();
    const vector =
      lower.includes("filter") || lower.includes("water")
        ? [1, 0, 0, 0]
        : lower.includes("vet") || lower.includes("appointment")
          ? [0, 1, 0, 0]
          : [0, 0, 0, 1];
    return { vector, model: input.model, version: input.version };
  },
};

function activeMembership(userId: string, id: string): HouseholdMembership {
  const at = new Date("2026-06-26T00:00:00Z");
  return {
    id,
    householdId,
    userId,
    invitedByUserId: OTHER_OWNER,
    role: userId === OTHER_OWNER ? "owner" : "member",
    status: "active",
    invitedAt: at,
    acceptedAt: at,
    removedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

function search(store: Parameters<typeof createSemanticRetrievalQueries>[0]) {
  return createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);
}

describe("semantic retrieval - general action results", () => {
  it("embeds a general action on demand and finds it by meaning with typed metadata", async () => {
    const { store, createGeneralAction, embedGeneralAction } = createHarness({
      adapter: vectorAdapter,
    });
    const action = await createGeneralAction({
      title: "Replace the refrigerator water filter",
      recurrence: { interval: 6, unit: "month" },
    });

    const outcome = await embedGeneralAction(action.id);
    expect(outcome.outcome).toBe("completed");

    const results = await search(store).searchSemanticContext({
      ownerUserId: OWNER,
      query: "water filter",
      minimumSimilarity: 0.5,
    });

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result?.recordKind).toBe("general_action");
    expect(result?.recordId).toBe(action.id);
    expect(result?.trustLevel).toBe("action_item");
    expect(result?.snippet).toBe("Replace the refrigerator water filter");
    // AC4: the typed result distinguishes a Routine from a one-time Action / Suggested.
    expect(result?.generalAction).toEqual({
      status: "open",
      isRoutine: true,
      isSuggested: false,
      areaId: null,
    });
  });

  it("distinguishes general actions from memories and source records in one query", async () => {
    const { store, processor, createApprovedMemory, createGeneralAction, embedGeneralAction } =
      createHarness({ adapter: vectorAdapter });
    const memory = await createApprovedMemory({ content: "Mara loves cooking water rituals." });
    const action = await createGeneralAction({ title: "Change the water filter" });
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });
    await processor.processEmbeddingJob({ jobId: job.id });
    await embedGeneralAction(action.id);

    const results = await search(store).searchSemanticContext({
      ownerUserId: OWNER,
      query: "water",
      minimumSimilarity: 0.5,
    });

    const byKind = new Set(results.map((result) => result.recordKind));
    expect(byKind.has("general_action")).toBe(true);
    expect(byKind.has("memory")).toBe(true);
    const actionResult = results.find((result) => result.recordKind === "general_action");
    expect(actionResult?.generalAction?.isRoutine).toBe(false);
    // Memory / source-record results never carry general-action metadata.
    const memoryResult = results.find((result) => result.recordKind === "memory");
    expect(memoryResult?.generalAction ?? null).toBeNull();
  });

  it("terminal and ignored actions never surface", async () => {
    const { store, createGeneralAction, embedGeneralAction } = createHarness({
      adapter: vectorAdapter,
    });
    const completed = await createGeneralAction({
      title: "Water filter done",
      status: "completed",
    });
    const ignored = await createGeneralAction({ title: "Water filter maybe", status: "ignored" });

    for (const action of [completed, ignored]) {
      const outcome = await embedGeneralAction(action.id);
      expect(outcome.outcome).toBe("skipped");
    }

    const results = await search(store).searchSemanticContext({
      ownerUserId: OWNER,
      query: "water filter",
      minimumSimilarity: 0.5,
      includeReviewGated: true,
    });
    expect(results).toHaveLength(0);
  });

  it("applies household scope before returning results", async () => {
    const { store, createGeneralAction, embedGeneralAction } = createHarness({
      adapter: vectorAdapter,
      householdMemberships: [
        activeMembership(OWNER, "membership-owner"),
        activeMembership(OTHER_OWNER, "membership-member"),
      ],
    });
    // A household-scoped action owned by a co-member: the caller (OWNER) may see it.
    const householdAction = await createGeneralAction({
      ownerUserId: OTHER_OWNER,
      title: "Household water filter swap",
      scope: "household",
      householdId,
    });
    // A private action owned by the co-member: never visible to the caller.
    const privateAction = await createGeneralAction({
      ownerUserId: OTHER_OWNER,
      title: "Private water filter errand",
      scope: "private",
    });
    await embedGeneralAction(householdAction.id, OTHER_OWNER);
    await embedGeneralAction(privateAction.id, OTHER_OWNER);

    const results = await search(store).searchSemanticContext({
      ownerUserId: OWNER,
      query: "water filter",
      minimumSimilarity: 0.5,
    });

    expect(results.map((result) => result.recordId)).toEqual([householdAction.id]);
    expect(results[0]?.visibilityChoice).toBe("whole_household");
  });

  it("keeps suggested proposals owner-only, even in review context", async () => {
    const { store, createGeneralAction, embedGeneralAction } = createHarness({
      adapter: vectorAdapter,
      householdMemberships: [
        activeMembership(OWNER, "membership-owner"),
        activeMembership(OTHER_OWNER, "membership-member"),
      ],
    });
    // A co-member's household-scoped suggested proposal: never visible to the caller,
    // review context or not (AC3, ADRs 0151-0153).
    const memberSuggested = await createGeneralAction({
      ownerUserId: OTHER_OWNER,
      title: "Suggested water filter for the house",
      status: "suggested",
      scope: "household",
      householdId,
    });
    // The caller's own suggested proposal: surfaces only with review context.
    const ownSuggested = await createGeneralAction({
      ownerUserId: OWNER,
      title: "Suggested water filter for me",
      status: "suggested",
    });
    await embedGeneralAction(memberSuggested.id, OTHER_OWNER);
    await embedGeneralAction(ownSuggested.id, OWNER);

    const withoutReview = await search(store).searchSemanticContext({
      ownerUserId: OWNER,
      query: "water filter",
      minimumSimilarity: 0.5,
    });
    expect(withoutReview).toHaveLength(0);

    const withReview = await search(store).searchSemanticContext({
      ownerUserId: OWNER,
      query: "water filter",
      minimumSimilarity: 0.5,
      includeReviewGated: true,
    });
    expect(withReview.map((result) => result.recordId)).toEqual([ownSuggested.id]);
    expect(withReview[0]?.generalAction).toMatchObject({ isSuggested: true, status: "suggested" });
  });

  it("excludes general actions from person-scoped queries", async () => {
    const { store, createPerson, createGeneralAction, embedGeneralAction } = createHarness({
      adapter: vectorAdapter,
    });
    const person = await createPerson("Mara Lin");
    const action = await createGeneralAction({ title: "Water filter task" });
    await embedGeneralAction(action.id);

    const results = await search(store).searchSemanticContext({
      ownerUserId: OWNER,
      query: "water filter",
      personId: person.id,
      minimumSimilarity: 0.5,
    });
    expect(results).toHaveLength(0);
  });
});
