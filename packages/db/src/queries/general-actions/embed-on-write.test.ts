import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionLifecycleStore } from "./in-memory-store";
import { createGeneralActionLifecycle } from "./lifecycle";
import { createSuggestedGeneralActionReview } from "./review";
import type { GeneralActionEmbeddingScheduler } from "./types";

const OWNER = "user-1";

type ScheduledEmbedding = { ownerUserId: string; recordKind: string; recordId: string };

function setup() {
  const store = createInMemoryGeneralActionLifecycleStore();
  const scheduled: ScheduledEmbedding[] = [];
  const scheduleGeneralActionEmbedding: GeneralActionEmbeddingScheduler = async (input) => {
    scheduled.push(input);
  };
  const lifecycle = createGeneralActionLifecycle(store, { scheduleGeneralActionEmbedding });
  const review = createSuggestedGeneralActionReview(store, { scheduleGeneralActionEmbedding });
  return { store, lifecycle, review, scheduled };
}

describe("general action embed-on-write", () => {
  it("schedules an embedding when a general action is created", async () => {
    const { lifecycle, scheduled } = setup();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
    });

    expect(scheduled).toEqual([
      { ownerUserId: OWNER, recordKind: "general_action", recordId: action.id },
    ]);
  });

  it("re-schedules an embedding when content is edited", async () => {
    const { lifecycle, scheduled } = setup();
    const action = await lifecycle.createGeneralAction({ ownerUserId: OWNER, title: "Old title" });
    scheduled.length = 0;

    await lifecycle.editGeneralAction({
      ownerUserId: OWNER,
      generalActionId: action.id,
      edit: { title: "New title" },
    });

    expect(scheduled).toEqual([
      { ownerUserId: OWNER, recordKind: "general_action", recordId: action.id },
    ]);
  });

  it("schedules embeddings across the review lifecycle (suggest, edit, accept)", async () => {
    const { store, review, scheduled } = setup();
    const source = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Fridge filter is due.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });

    const suggested = await review.suggestGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      sourceRecordId: source.id,
    });
    const actionId = suggested.action.id;

    await review.editSuggestedGeneralAction({
      ownerUserId: OWNER,
      generalActionId: actionId,
      edit: { notes: "Every 6 months" },
    });
    await review.acceptSuggestedGeneralAction({ ownerUserId: OWNER, generalActionId: actionId });

    // Suggested → edited → accepted each re-embed the single proposal row.
    expect(scheduled).toEqual([
      { ownerUserId: OWNER, recordKind: "general_action", recordId: actionId },
      { ownerUserId: OWNER, recordKind: "general_action", recordId: actionId },
      { ownerUserId: OWNER, recordKind: "general_action", recordId: actionId },
    ]);
  });

  it("does not require a scheduler (defaults to a no-op)", async () => {
    const store = createInMemoryGeneralActionLifecycleStore();
    const lifecycle = createGeneralActionLifecycle(store);
    await expect(
      lifecycle.createGeneralAction({ ownerUserId: OWNER, title: "No scheduler wired" }),
    ).resolves.toMatchObject({ status: "open" });
  });
});
