import type { GeneralAction, HouseholdMembership } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { HouseholdRecordShare } from "../households/types";
import { createInMemoryRelationshipContextSearchStore } from "./in-memory-store";
import { createRelationshipContextSearchQueries } from "./queries";

const OWNER = "owner-1";
const MEMBER = "owner-2";
const householdId = "99999999-9999-4999-8999-999999999999";
const now = new Date("2026-06-26T00:00:00Z");

function action(overrides: Partial<GeneralAction> = {}): GeneralAction {
  return {
    id: overrides.id ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ownerUserId: OWNER,
    title: "Replace the refrigerator water filter",
    notes: null,
    links: [],
    status: "open",
    dueAt: null,
    deferUntil: null,
    sourceRecordId: null,
    areaId: null,
    scope: "private",
    householdId: null,
    assetHints: [],
    recurrence: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function activeMembership(userId: string, id: string): HouseholdMembership {
  return {
    id,
    householdId,
    userId,
    invitedByUserId: MEMBER,
    role: userId === MEMBER ? "owner" : "member",
    status: "active",
    invitedAt: now,
    acceptedAt: now,
    removedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("exact recall - general action results", () => {
  it("finds a general action by explicit text with typed metadata", async () => {
    const store = createInMemoryRelationshipContextSearchStore({
      generalActions: [
        action({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Replace the refrigerator water filter",
          recurrence: { interval: 6, unit: "month" },
          areaId: "area-1",
        }),
      ],
    });
    const queries = createRelationshipContextSearchQueries(store);

    const results = await queries.searchRelationshipContext({
      ownerUserId: OWNER,
      query: "water filter",
    });

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result?.recordKind).toBe("general_action");
    expect(result?.trustLevel).toBe("action_item");
    expect(result?.label).toBe("Replace the refrigerator water filter");
    expect(result?.matchedFields).toContain("title");
    expect(result?.generalAction).toEqual({
      status: "open",
      isRoutine: true,
      isSuggested: false,
      areaId: "area-1",
    });
  });

  it("matches on notes as well as title", async () => {
    const store = createInMemoryRelationshipContextSearchStore({
      generalActions: [
        action({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Book an errand",
          notes: "Pick up a new furnace filter this weekend",
        }),
      ],
    });
    const queries = createRelationshipContextSearchQueries(store);

    const results = await queries.searchRelationshipContext({
      ownerUserId: OWNER,
      query: "furnace filter",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.matchedFields).toContain("notes");
  });

  it("excludes terminal, ignored, and (without review context) suggested actions", async () => {
    const store = createInMemoryRelationshipContextSearchStore({
      generalActions: [
        action({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Filter done",
          status: "completed",
        }),
        action({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Filter ignored",
          status: "ignored",
        }),
        action({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Filter suggested",
          status: "suggested",
        }),
      ],
    });
    const queries = createRelationshipContextSearchQueries(store);

    const withoutReview = await queries.searchRelationshipContext({
      ownerUserId: OWNER,
      query: "filter",
    });
    expect(withoutReview).toHaveLength(0);

    const withReview = await queries.searchRelationshipContext({
      ownerUserId: OWNER,
      query: "filter",
      includeReviewGated: true,
    });
    // Only the owner's suggested proposal appears in review context; terminal/ignored stay hidden.
    expect(withReview.map((result) => result.recordId)).toEqual([
      "33333333-3333-4333-8333-333333333333",
    ]);

    const withHistory = await queries.searchRelationshipContext({
      ownerUserId: OWNER,
      query: "filter",
      includeArchived: true,
    });
    expect(withHistory.map((result) => result.recordId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("applies household scope, and keeps suggested proposals owner-only", async () => {
    const householdRecordShares: HouseholdRecordShare[] = [];
    const store = createInMemoryRelationshipContextSearchStore({
      generalActions: [
        action({
          id: "44444444-4444-4444-8444-444444444444",
          ownerUserId: MEMBER,
          title: "Household filter swap",
          scope: "household",
          householdId,
        }),
        action({
          id: "55555555-5555-4555-8555-555555555555",
          ownerUserId: MEMBER,
          title: "Private filter errand",
          scope: "private",
        }),
        action({
          id: "66666666-6666-4666-8666-666666666666",
          ownerUserId: MEMBER,
          title: "Suggested filter for the house",
          status: "suggested",
          scope: "household",
          householdId,
        }),
      ],
      householdMemberships: [
        activeMembership(OWNER, "membership-owner"),
        activeMembership(MEMBER, "membership-member"),
      ],
      householdRecordShares,
    });
    const queries = createRelationshipContextSearchQueries(store);

    const results = await queries.searchRelationshipContext({
      ownerUserId: OWNER,
      query: "filter",
      includeReviewGated: true,
    });

    // The household action is visible; the co-member's private and suggested rows are not.
    expect(results.map((result) => result.recordId)).toEqual([
      "44444444-4444-4444-8444-444444444444",
    ]);
  });

  it("enforces scope from the live row: a narrow-to-private drops it from the member's search", async () => {
    // Scope is evaluated against the current row at query time (not baked into an index),
    // so re-scoping a row changes who can retrieve it on the very next search.
    const householdAction = action({
      id: "77777777-7777-4777-8777-777777777777",
      ownerUserId: MEMBER,
      title: "Household filter swap",
      scope: "household",
      householdId,
    });
    const store = createInMemoryRelationshipContextSearchStore({
      generalActions: [householdAction],
      householdMemberships: [
        activeMembership(OWNER, "membership-owner"),
        activeMembership(MEMBER, "membership-member"),
      ],
    });
    const queries = createRelationshipContextSearchQueries(store);

    // The member (OWNER) can retrieve the household-scoped action.
    const before = await queries.searchRelationshipContext({ ownerUserId: OWNER, query: "filter" });
    expect(before.map((result) => result.recordId)).toEqual([householdAction.id]);

    // The owner narrows visibility to private (clearing the household), fail-closed.
    householdAction.scope = "private";
    householdAction.householdId = null;

    // The member's next search no longer sees it.
    const after = await queries.searchRelationshipContext({ ownerUserId: OWNER, query: "filter" });
    expect(after).toHaveLength(0);
    // The owner still finds their own now-private action.
    const ownerView = await queries.searchRelationshipContext({
      ownerUserId: MEMBER,
      query: "filter",
    });
    expect(ownerView.map((result) => result.recordId)).toEqual([householdAction.id]);
  });
});
