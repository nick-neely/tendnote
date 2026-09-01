import type { SourceRecord } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createGeneralActionAreaManager } from "../general-action-areas/lifecycle";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryGeneralActionLifecycleStore } from "./in-memory-store";
import { createGeneralActionLifecycle } from "./lifecycle";
import { createSuggestedGeneralActionReview } from "./review";

const OWNER = "user-1";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

async function setup() {
  const store = createInMemoryGeneralActionLifecycleStore();
  const review = createSuggestedGeneralActionReview(store);
  const lifecycle = createGeneralActionLifecycle(store);
  const areas = createGeneralActionAreaManager(store);

  async function seedSource(
    overrides: Partial<Parameters<typeof store.createSourceRecord>[0]> = {},
  ) {
    return store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Fridge filter is due — replace it and set a reminder every 6 months.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
      ...overrides,
    });
  }

  async function seedSuggested(overrides: Record<string, unknown> = {}) {
    const source = (overrides.source as SourceRecord) ?? (await seedSource());
    const result = await review.suggestGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      sourceRecordId: source.id,
      ...overrides,
    });
    return { result, source };
  }

  const historyKinds = async (generalActionId: string) =>
    (await lifecycle.listGeneralActionHistory({ actorUserId: OWNER, generalActionId })).map(
      (event) => event.kind,
    );

  return { store, review, lifecycle, areas, seedSource, seedSuggested, historyKinds };
}

/**
 * Assert a promoted proposal is the owner's sole active ledger entry and carries the given
 * history trail. Shared by the accept- and reopen-in-place cases, which agree on the ledger
 * shape and differ only in the exact sequence of history kinds.
 */
async function expectSoleActiveWithHistory(
  lifecycle: Awaited<ReturnType<typeof setup>>["lifecycle"],
  historyKinds: Awaited<ReturnType<typeof setup>>["historyKinds"],
  actionId: string,
  expectedHistory: string[],
) {
  const active = await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER });
  expect(active.map((a) => a.id)).toEqual([actionId]);
  await expect(historyKinds(actionId)).resolves.toEqual(expectedHistory);
}

describe("suggest a general action", () => {
  it("persists a grounded, private, suggested proposal that is not on the active ledger", async () => {
    const { review, lifecycle, seedSource } = await setup();
    const source = await seedSource();

    const { action, sourceRecord, component } = await review.suggestGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      notes: "Model MWF",
      dueAt: new Date("2026-08-01T00:00:00Z"),
      recurrence: { interval: 6, unit: "month" },
      sourceRecordId: source.id,
    });

    expect(action.status).toBe("suggested");
    expect(action.scope).toBe("private");
    expect(action.sourceRecordId).toBe(source.id);
    expect(action.createdByUserId).toBe(OWNER);
    expect(action.recurrence).toEqual({ interval: 6, unit: "month" });
    expect(sourceRecord?.id).toBe(source.id);
    expect(component).toEqual({
      type: "suggested_general_action_review",
      generalActionId: action.id,
      sourceRecordId: source.id,
    });

    // A suggestion never shows up as an active or resolved Action.
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(lifecycle.listResolvedGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
  });

  it("requires source grounding", async () => {
    const { review } = await setup();
    await expect(
      review.suggestGeneralAction({
        ownerUserId: OWNER,
        title: "Ungrounded",
        sourceRecordId: "00000000-0000-0000-0000-0000000000ff",
      }),
    ).rejects.toThrow(/grounded in a source record/);
  });

  it("refuses to ground a proactive suggestion in restricted context", async () => {
    const { review, seedSource } = await setup();
    const restricted = await seedSource({ sensitivity: "restricted" });
    await expect(
      review.suggestGeneralAction({
        ownerUserId: OWNER,
        title: "From restricted note",
        sourceRecordId: restricted.id,
      }),
    ).rejects.toThrow(/Restricted context/);
  });

  it("lists suggested proposals for the owner and hydrates grounding", async () => {
    const { review, seedSuggested } = await setup();
    const { result } = await seedSuggested();

    const reviews = await review.listSuggestedGeneralActionReviews({ ownerUserId: OWNER });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.action.id).toBe(result.action.id);
    expect(reviews[0]?.sourceRecord?.id).toBe(result.sourceRecord?.id);
  });
});

describe("accept a suggested general action", () => {
  it("promotes it in place to a durable open action with accepted-by provenance", async () => {
    const { review, lifecycle, seedSuggested, historyKinds } = await setup();
    const { result } = await seedSuggested();

    const accepted = await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });

    expect(accepted.action.id).toBe(result.action.id);
    expect(accepted.action.status).toBe("open");
    // Grounding is preserved through promotion.
    expect(accepted.action.sourceRecordId).toBe(result.sourceRecord?.id);
    expect(accepted.action.lastActorUserId).toBe(OWNER);

    // It now appears on the active ledger; no second action was created.
    await expectSoleActiveWithHistory(lifecycle, historyKinds, result.action.id, [
      "suggested",
      "promoted",
    ]);
  });

  it("keeps a cadence so an accepted recurring proposal becomes a Routine", async () => {
    const { review, seedSuggested } = await setup();
    const { result } = await seedSuggested({ recurrence: { interval: 6, unit: "month" } });

    const accepted = await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });
    expect(accepted.action.status).toBe("open");
    expect(accepted.action.recurrence).toEqual({ interval: 6, unit: "month" });
  });

  it("applies an edit before promotion", async () => {
    const { review, seedSuggested } = await setup();
    const { result } = await seedSuggested();

    const accepted = await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
      edit: { title: "Replace the water filter (kitchen)", notes: "Ordered a 2-pack" },
    });
    expect(accepted.action.title).toBe("Replace the water filter (kitchen)");
    expect(accepted.action.notes).toBe("Ordered a 2-pack");
  });

  it("is idempotent: re-accepting an already-promoted proposal is a no-op, no duplicate", async () => {
    const { review, lifecycle, seedSuggested } = await setup();
    const { result } = await seedSuggested();

    const first = await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });
    const second = await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });

    expect(second.action.id).toBe(first.action.id);
    expect(second.action.status).toBe("open");
    const active = await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER });
    expect(active).toHaveLength(1);
  });

  it("refuses to accept an ignored proposal", async () => {
    const { review, seedSuggested } = await setup();
    const { result } = await seedSuggested();
    await review.ignoreSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });

    await expect(
      review.acceptSuggestedGeneralAction({
        actorUserId: OWNER,
        generalActionId: result.action.id,
      }),
    ).rejects.toThrow(/set aside/);
  });

  it("finalizes a household scope at acceptance so a member can see the promoted action", async () => {
    const { store, review, lifecycle, seedSuggested } = await setup();
    const household = await seedHouseholdWithMembers(store, {
      ownerUserId: OWNER,
      name: "Home",
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
      ],
    });
    const { result } = await seedSuggested({ scope: "household", householdId: household.id });

    // A still-suggested household proposal is not on any member's active ledger.
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: MEMBER })).resolves.toEqual([]);

    await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });

    const memberView = await lifecycle.listActiveGeneralActions({ ownerUserId: MEMBER });
    expect(memberView.map((a) => a.id)).toEqual([result.action.id]);
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: OUTSIDER })).resolves.toEqual(
      [],
    );
  });

  it("keeps a still-suggested household proposal owner-only on GET and HISTORY", async () => {
    const { store, review, lifecycle, seedSuggested } = await setup();
    const household = await seedHouseholdWithMembers(store, {
      ownerUserId: OWNER,
      name: "Home",
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
      ],
    });
    const { result } = await seedSuggested({ scope: "household", householdId: household.id });

    // A member cannot fetch a not-yet-accepted household proposal by id, nor read its
    // history — visibility begins only at acceptance (ADRs 0151, 0152, 0153).
    await expect(
      store.getVisibleGeneralAction({ callerUserId: MEMBER, generalActionId: result.action.id }),
    ).resolves.toBeNull();
    await expect(
      lifecycle.listGeneralActionHistory({
        actorUserId: MEMBER,
        generalActionId: result.action.id,
      }),
    ).resolves.toEqual([]);

    // Once accepted, the same member can see it and read its history.
    await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });
    await expect(
      store.getVisibleGeneralAction({ callerUserId: MEMBER, generalActionId: result.action.id }),
    ).resolves.toMatchObject({ id: result.action.id });
    const memberHistory = await lifecycle.listGeneralActionHistory({
      actorUserId: MEMBER,
      generalActionId: result.action.id,
    });
    expect(memberHistory.map((event) => event.kind)).toEqual(["suggested", "promoted"]);
  });
});

describe("edit, dismiss, and ignore a suggested general action", () => {
  it("edits the proposal in place while it stays suggested", async () => {
    const { review, seedSuggested, historyKinds } = await setup();
    const { result } = await seedSuggested();

    const edited = await review.editSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
      edit: { title: "Replace the fridge filter" },
    });
    expect(edited.action.status).toBe("suggested");
    expect(edited.action.title).toBe("Replace the fridge filter");
    await expect(historyKinds(result.action.id)).resolves.toEqual(["suggested", "edited"]);
  });

  it("rejects a no-op review edit", async () => {
    const { review, seedSuggested } = await setup();
    const { result } = await seedSuggested();
    await expect(
      review.editSuggestedGeneralAction({
        actorUserId: OWNER,
        generalActionId: result.action.id,
        edit: {},
      }),
    ).rejects.toThrow(/A review edit must change/);
  });

  it("dismisses a proposal to the shared dismissed terminal", async () => {
    const { review, lifecycle, seedSuggested } = await setup();
    const { result } = await seedSuggested();

    const dismissed = await review.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });
    expect(dismissed.status).toBe("dismissed");
    // Gone from the active ledger; recoverable from the resolved trail like any dismissal.
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
    const resolved = await lifecycle.listResolvedGeneralActions({ ownerUserId: OWNER });
    expect(resolved.map((a) => a.id)).toEqual([result.action.id]);
  });

  it("keeps a dismissed household proposal owner-only — rejection never publishes it to the household", async () => {
    // Proposal visibility begins only at acceptance. A household-scoped proposal that is
    // *rejected* (dismissed straight from suggested, never accepted) must not become
    // readable by the whole household: `dismissed` is a scope-visible terminal, so the
    // record is dropped back to private on rejection. A member can neither fetch it by id
    // nor see it in their visible list; the owner keeps it in their own resolved trail.
    const { store, review, lifecycle, seedSuggested } = await setup();
    const household = await seedHouseholdWithMembers(store, {
      ownerUserId: OWNER,
      name: "Home",
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
      ],
    });
    const { result } = await seedSuggested({ scope: "household", householdId: household.id });

    const dismissed = await review.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });
    expect(dismissed).toMatchObject({ status: "dismissed", scope: "private", householdId: null });

    // A household member can neither fetch the rejected proposal by id nor list it.
    await expect(
      store.getVisibleGeneralAction({ callerUserId: MEMBER, generalActionId: result.action.id }),
    ).resolves.toBeNull();
    await expect(
      store.listVisibleGeneralActionsForCaller({ callerUserId: MEMBER }),
    ).resolves.toEqual([]);

    // The owner still holds it in their own resolved trail.
    const resolved = await lifecycle.listResolvedGeneralActions({ ownerUserId: OWNER });
    expect(resolved.map((a) => a.id)).toEqual([result.action.id]);
  });

  it("restores a just-dismissed proposal to review for authoritative Undo", async () => {
    const { review, seedSuggested, historyKinds } = await setup();
    const { result } = await seedSuggested();
    await review.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });

    const restored = await review.restoreDismissedSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });

    expect(restored.action.status).toBe("suggested");
    await expect(
      review.listSuggestedGeneralActionReviews({ ownerUserId: OWNER }),
    ).resolves.toHaveLength(1);
    await expect(historyKinds(result.action.id)).resolves.toEqual([
      "suggested",
      "dismissed",
      "reopened",
    ]);
  });

  it("reopens a dismissed proposal into a durable action as a late-acceptance recovery", async () => {
    const { review, lifecycle, seedSuggested, historyKinds } = await setup();
    const { result } = await seedSuggested();
    await review.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });

    // Reopening a dismissed proposal is deliberate: it becomes a durable open Action,
    // and the `reopened` history event records the change of mind so the promotion is
    // never silent.
    const reopened = await lifecycle.reopenGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });
    expect(reopened.status).toBe("open");
    await expectSoleActiveWithHistory(lifecycle, historyKinds, result.action.id, [
      "suggested",
      "dismissed",
      "reopened",
    ]);
  });

  it("ignores a proposal quietly — off the active and resolved ledgers alike", async () => {
    const { review, lifecycle, seedSuggested } = await setup();
    const { result } = await seedSuggested();

    const ignored = await review.ignoreSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });
    expect(ignored.status).toBe("ignored");
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(lifecycle.listResolvedGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
  });

  it("refuses to review another owner's or a non-suggested action", async () => {
    const { review, seedSuggested } = await setup();
    const { result } = await seedSuggested();
    await review.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: result.action.id,
    });

    // Now open, not suggested: edit/dismiss/ignore must refuse.
    await expect(
      review.editSuggestedGeneralAction({
        actorUserId: OWNER,
        generalActionId: result.action.id,
        edit: { title: "x" },
      }),
    ).rejects.toThrow(/Only suggested actions/);
    await expect(
      review.dismissSuggestedGeneralAction({
        actorUserId: OWNER,
        generalActionId: result.action.id,
      }),
    ).rejects.toThrow(/Only suggested actions/);
  });
});
