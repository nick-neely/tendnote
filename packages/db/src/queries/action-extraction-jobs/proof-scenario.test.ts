import { createFakeSuggestedActionExtractionAdapter } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createGeneralActionAreaManager } from "../general-action-areas/lifecycle";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createSuggestedGeneralActionReview } from "../general-actions/review";
import { createInMemoryActionExtractionJobStore } from "./in-memory-store";
import { createActionExtractionProcessor } from "./processor";

const OWNER = "user-1";
const MEMBER = "user-member";

/**
 * Phase 5 proof scenario (PRD): a user captures that the refrigerator water filter needs
 * replacing every six months. Extraction proposes a Suggested General Action with a Home
 * Area, a six-month recurrence, household scope, a lightweight asset hint, and source
 * grounding — reviewable, never an active Action until accepted.
 */
describe("refrigerator water filter proof scenario", () => {
  it("proposes a grounded, household-scoped, recurring Suggested General Action with Area and asset hint", async () => {
    const store = createInMemoryActionExtractionJobStore();
    const areas = createGeneralActionAreaManager(store);
    const lifecycle = createGeneralActionLifecycle(store);

    // Owner has a Home Area and an active household — the shared-home context the owner
    // themselves scoped the capture to (guild/channel context never widens scope).
    const home = await areas.createArea({ ownerUserId: OWNER, name: "Home" });
    const household = await store.createHouseholdWorkspace({
      ownerUserId: OWNER,
      name: "Home",
      defaultScope: "private",
    });
    for (const [userId, role] of [
      [OWNER, "owner"],
      [MEMBER, "member"],
    ] as const) {
      await store.createHouseholdMembership({
        householdId: household.id,
        userId,
        invitedByUserId: OWNER,
        role,
        status: "active",
        invitedAt: new Date("2026-06-01T00:00:00Z"),
        acceptedAt: new Date("2026-06-01T00:00:00Z"),
        removedAt: null,
      });
    }

    const source = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Fridge filter is due — replace it every six months.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "household",
      householdId: household.id,
      importance: 3,
      metadataJson: {},
    });

    const adapter = createFakeSuggestedActionExtractionAdapter([
      {
        title: "Replace the refrigerator water filter",
        reason: "Filter is due; keep the water clean",
        recurrence: { interval: 6, unit: "month" },
        areaId: home.id,
        assetHints: [{ label: "refrigerator water filter" }],
        scope: "household",
      },
    ]);
    const processor = createActionExtractionProcessor(store, { extractionAdapter: adapter });

    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });
    const result = await processor.processActionExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedActionIds).toHaveLength(1);

    const actions = await store.listGeneralActionsForSourceRecord({
      ownerUserId: OWNER,
      sourceRecordId: source.id,
    });
    expect(actions).toHaveLength(1);
    const action = actions[0];
    expect(action?.status).toBe("suggested");
    expect(action?.title).toBe("Replace the refrigerator water filter");
    expect(action?.recurrence).toEqual({ interval: 6, unit: "month" });
    expect(action?.areaId).toBe(home.id);
    expect(action?.assetHints).toEqual([{ label: "refrigerator water filter" }]);
    expect(action?.scope).toBe("household");
    expect(action?.householdId).toBe(household.id);
    expect(action?.sourceRecordId).toBe(source.id);
    expect(action?.notes).toBe("Filter is due; keep the water clean");

    // Still a proposal: never on the active or resolved Actions ledger until accepted.
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
    // The member cannot see the still-suggested household proposal either.
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: MEMBER })).resolves.toEqual([]);

    // And it accepts in place into a durable, household-visible Routine.
    const review = createSuggestedGeneralActionReview(store);
    await review.acceptSuggestedGeneralAction({
      ownerUserId: OWNER,
      generalActionId: action?.id ?? "",
    });
    const memberView = await lifecycle.listActiveGeneralActions({ ownerUserId: MEMBER });
    expect(memberView.map((a) => a.id)).toEqual([action?.id]);
  });
});
