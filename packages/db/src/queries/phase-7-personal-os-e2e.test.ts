import type { ExactRecallResult, SemanticRetrievalResult } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryAssetSearchStore } from "./asset-search/in-memory-store";
import { createAssetSearch } from "./asset-search/queries";
import { createAssetActionLinks } from "./assets/action-links";
import { createInMemoryAssetActionLinkStore } from "./assets/in-memory-action-link-store";
import { createAssetReview } from "./assets/review";
import { createConversationalCapture } from "./capture/conversational-capture";
import { createAffectedGeneralActionLifecycle } from "./general-actions/mutation-lifecycle";
import { createGlobalRecall } from "./global-recall/queries";
import { createExplicitCaptureReminderScheduler } from "./reminders";
import { createInMemoryReminderStore } from "./reminders/in-memory-store";
import { createReminderService } from "./reminders/service";
import { createInMemorySavedItemLifecycleStore } from "./saved-items/in-memory-store";
import { createSavedItemLifecycle } from "./saved-items/lifecycle";
import { createTodayCandidateLoaders } from "./today/candidate-loaders";
import { createInMemoryTodayFeedbackStore } from "./today/in-memory-store";
import { createTodayShortlistService } from "./today/service";

/**
 * Phase Seven's refrigerator-filter proof, composed through the same owner-scoped product
 * functions used by Capture, Today, Search, Eve, Review, and Reminder delivery. Slice suites
 * prove each policy independently; this proves the hand-offs do not lose grounding, authority,
 * lifecycle state, or deterministic fallback when the capabilities are used as one product.
 */

const OWNER = "owner-1";
const OUTSIDER = "owner-2";
const CAPTURED_AT = new Date("2026-07-21T15:00:00.000Z");
const ALERT_AT = new Date("2026-08-14T14:00:00.000Z");

function themedVector(text: string) {
  return /fridge|refrigerator|filter|appliance|kitchen/i.test(text) ? [1, 0] : [0, 1];
}

describe("Phase Seven proof — refrigerator filter across the Personal OS", () => {
  it("keeps one grounded Capture coherent through review, Today, push, Search, and Eve recall", async () => {
    const productStore = {
      ...createInMemoryAssetActionLinkStore(),
      ...createInMemorySavedItemLifecycleStore(),
    };
    const actions = createAffectedGeneralActionLifecycle(productStore);
    const savedItems = createSavedItemLifecycle(productStore);
    const assetReview = createAssetReview(productStore);
    const assetLinks = createAssetActionLinks(productStore);
    const capture = createConversationalCapture(productStore, {
      createGeneralAction: actions.createGeneralAction,
      getGeneralAction: ({ ownerUserId, generalActionId }) =>
        productStore.getGeneralAction({ ownerUserId, generalActionId }),
      suggestAsset: async (input) => ({
        result: await assetReview.suggestAsset(input),
        affectedScopes: [],
      }),
      ownerTimeZone: async () => "America/Chicago",
      now: () => CAPTURED_AT,
    });

    const captured = await capture.capture({
      authority: "explicit",
      interactionId: "phase-seven-filter-proof",
      inputMode: "typed",
      inferredSuggestions: [
        {
          kind: "asset",
          assetName: "Kitchen refrigerator",
          assetKind: "appliance",
          fact: "Filter model EDR1RXD1",
        },
      ],
      ownerUserId: OWNER,
      originalText:
        "Remind me to replace the kitchen refrigerator filter on August 21 with an alert one week before; and also save an open question: Where should I buy the replacement filter? Bring it back on August 14",
      surface: "global_capture",
    });

    expect(captured.confirmation).toMatchObject({
      destination: "Grouped",
      groundedBySourceRecordId: captured.sourceRecord.id,
      outcomes: [
        { destination: "Actions" },
        { destination: "Saved Items" },
        { destination: "Review" },
      ],
    });
    const actionOutcome = captured.outcomes?.find((outcome) => outcome.kind === "general_action");
    const savedOutcome = captured.outcomes?.find((outcome) => outcome.kind === "saved_item");
    const reviewOutcome = captured.outcomes?.find((outcome) => outcome.kind === "asset_review");
    if (
      actionOutcome?.kind !== "general_action" ||
      savedOutcome?.kind !== "saved_item" ||
      reviewOutcome?.kind !== "asset_review"
    ) {
      throw new Error("The Phase Seven Capture did not produce its three bounded outcomes.");
    }
    expect(actionOutcome.generalAction.sourceRecordId).toBe(captured.sourceRecord.id);
    expect(savedOutcome.savedItem).toMatchObject({
      kind: "open_question",
      scope: "private",
      sourceRecordId: captured.sourceRecord.id,
      bringBackAt: ALERT_AT,
    });
    expect(reviewOutcome.assetReview).toMatchObject({
      asset: { name: "Kitchen refrigerator", status: "suggested" },
      group: { sourceRecordId: captured.sourceRecord.id },
    });
    expect(await actions.listActiveGeneralActions({ ownerUserId: OWNER })).toHaveLength(1);
    expect(await actions.listActiveGeneralActions({ ownerUserId: OUTSIDER })).toEqual([]);

    const acceptedReview = await assetReview.acceptAssetReviewGroup({
      actorUserId: OWNER,
      groupId: reviewOutcome.assetReview.group.id,
    });
    const asset = acceptedReview.asset;
    const memories = await assetReview.listAssetMemories({
      callerUserId: OWNER,
      assetId: asset.id,
    });
    expect(memories).toEqual([
      expect.objectContaining({
        label: "Captured detail",
        notes: "Filter model EDR1RXD1",
        status: "active",
      }),
    ]);
    const linkedActionOutcome = await actions.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionOutcome.generalAction.id,
      edit: { assetHints: [{ label: "kitchen refrigerator filter" }] },
    });
    const linkedAction = linkedActionOutcome.result;
    expect(linkedAction.sourceRecordId).toBe(captured.sourceRecord.id);
    const promotedHint = await assetLinks.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: linkedAction.id,
      hintLabel: "kitchen refrigerator filter",
      kind: "appliance",
    });
    if (promotedHint.outcome !== "pending_review") {
      throw new Error("The explicit Asset link did not enter the existing review path.");
    }
    await assetReview.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId: promotedHint.group.group.id,
      targetAssetId: asset.id,
    });
    await expect(
      assetLinks.listLinkedAssetsForGeneralActions({
        callerUserId: OWNER,
        generalActionIds: [actionOutcome.generalAction.id],
      }),
    ).resolves.toMatchObject({
      [actionOutcome.generalAction.id]: [{ asset: { id: asset.id, status: "active" } }],
    });

    const reminderStore = createInMemoryReminderStore();
    const reminders = createReminderService({
      store: reminderStore,
      async loadReminderRecord(input) {
        if (input.recordKind === "general_action") {
          const action = await productStore.getGeneralAction({
            ownerUserId: input.ownerUserId,
            generalActionId: input.recordId,
          });
          return action
            ? {
                id: action.id,
                kind: "general_action" as const,
                ownerUserId: action.ownerUserId,
                title: action.title,
                status: action.status,
                occursAt: action.dueAt,
                timeSemantics: "date_only" as const,
                recurrence: action.recurrence,
                sensitivity: "normal" as const,
                scope: action.scope,
                deepLink: `/actions#action-${action.id}`,
              }
            : null;
        }
        if (input.recordKind === "saved_item") {
          const item = await productStore.getVisibleSavedItem({
            callerUserId: input.ownerUserId,
            savedItemId: input.recordId,
          });
          return item
            ? {
                id: item.id,
                kind: "saved_item" as const,
                ownerUserId: item.ownerUserId,
                title: item.title,
                status: item.status,
                occursAt: item.bringBackAt,
                timeSemantics: item.bringBackTimeSemantics,
                recurrence: null,
                sensitivity: "normal" as const,
                scope: item.scope,
                deepLink: `/saved-items#saved-item-${item.id}`,
              }
            : null;
        }
        return null;
      },
    });
    const scheduleCapturedReminders = createExplicitCaptureReminderScheduler((async (
      input: Parameters<typeof reminders.saveReminder>[0],
    ) => ({
      result: await reminders.saveReminder(input),
      affectedScopes: [
        { kind: "owner-collection", collection: "today", ownerUserId: input.ownerUserId },
      ],
    })) as never);
    const confirmed = await scheduleCapturedReminders({
      ownerUserId: OWNER,
      originalText: captured.sourceRecord.content,
      clientInstallationId: "ios-safari-installation",
      timeZone: "America/Chicago",
      result: captured,
      now: CAPTURED_AT,
    });
    expect(confirmed.result).toMatchObject({
      destination: "Grouped",
      outcomes: [
        { interpreted: { reminderSchedule: expect.stringMatching(/one week before/) } },
        { destination: "Saved Items" },
        { destination: "Review" },
      ],
    });
    await expect(reminderStore.listSchedulesForOwner({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        recordKind: "general_action",
        recordId: actionOutcome.generalAction.id,
        kind: "relative",
        leadMinutes: 10_080,
        intendedAt: ALERT_AT,
      }),
    ]);
    await expect(
      reminderStore.getOptInState({
        ownerUserId: OWNER,
        clientInstallationId: "ios-safari-installation",
      }),
    ).resolves.toMatchObject({ state: "offered" });

    const registration = await reminders.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "ios-safari-installation",
      label: "iPhone Home Screen",
      subscription: {
        endpoint: "https://push.example.test/phase-seven",
        expirationTime: null,
        keys: { p256dh: "phase-seven-p256dh", auth: "phase-seven-auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    expect(registration.installation.previewMode).toBe("generic");
    const sender = vi.fn(async () => {
      throw new Error("push provider unavailable");
    });
    await expect(
      reminders.dispatchReminder({
        jobId: registration.deliveryJobs[0]?.id ?? "missing-job",
        now: new Date("2026-08-14T14:00:05.000Z"),
        sender,
      }),
    ).resolves.toMatchObject({ status: "retry_scheduled" });
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          title: "Tendnote reminder",
          data: {
            url: `/reminders/open?kind=general_action&id=${actionOutcome.generalAction.id}`,
            recordKind: "general_action",
            recordId: actionOutcome.generalAction.id,
          },
        }),
      }),
    );
    await expect(
      reminders.resolveReminderDeepLink({
        ownerUserId: OWNER,
        recordKind: "general_action",
        recordId: actionOutcome.generalAction.id,
      }),
    ).resolves.toBe(`/actions#action-${actionOutcome.generalAction.id}`);

    const today = createTodayShortlistService({
      feedbackStore: createInMemoryTodayFeedbackStore(),
      loadCandidateFamilies: createTodayCandidateLoaders({
        loadRelationshipAgenda: async () => [],
        listActions: ({ ownerUserId }) => productStore.listGeneralActionsForOwner({ ownerUserId }),
        listSavedItems: ({ callerUserId, includeArchived, limit }) =>
          savedItems.listSavedItems({ callerUserId, includeArchived, limit }),
        getSourceRecord: ({ ownerUserId, sourceRecordId }) =>
          productStore.getSourceRecord({ ownerUserId, sourceRecordId }),
        readCalendar: async () => ({ connected: false, result: null }),
        listAdditionalReviews: async () => [],
      }),
      rankOptional: vi.fn(async () => {
        throw new Error("Eve unavailable");
      }),
    });
    const todayResult = await today.getTodayShortlist({
      ownerUserId: OWNER,
      localDate: "2026-08-14",
      timeZone: "America/Chicago",
      now: new Date("2026-08-14T15:00:00.000Z"),
    });
    expect(todayResult.curation).toBe("deterministic_fallback");
    expect(todayResult.limitations).toContain(
      "Eve ranking is unavailable; deterministic ordering used.",
    );
    expect(todayResult.items).toHaveLength(1);
    expect(todayResult.items[0]?.identity).toBe(`saved_item:${savedOutcome.savedItem.id}`);
    expect(todayResult.items[0]?.reason.explanation).toMatch(/bring back|set to return/i);
    const todayItem = todayResult.items[0];
    if (!todayItem) throw new Error("The due Saved Item did not reach Today.");
    await today.suppressTodayCandidate({
      ownerUserId: OWNER,
      localDate: "2026-08-14",
      timeZone: "America/Chicago",
      now: new Date("2026-08-14T15:01:00.000Z"),
      candidateIdentity: todayItem.identity,
      reasonKey: todayItem.reason.key,
      kind: "not_today",
      suppressUntil: null,
    });
    await expect(
      productStore.getVisibleSavedItem({
        callerUserId: OWNER,
        savedItemId: savedOutcome.savedItem.id,
      }),
    ).resolves.toMatchObject({ status: "active", bringBackAt: ALERT_AT });

    const exactAction = (ownerUserId: string): ExactRecallResult[] =>
      ownerUserId === OWNER
        ? [
            {
              recordKind: "general_action",
              recordId: actionOutcome.generalAction.id,
              visibilityChoice: "only_me",
              visibilityLabel: "Only me",
              relatedPersonId: null,
              relatedPersonDisplayName: null,
              label: "Replace the kitchen refrigerator filter",
              snippet: "Replace the kitchen refrigerator filter",
              matchedFields: ["title"],
              rank: 1,
              trustLevel: "action_item",
              sensitivity: "normal",
              generalAction: {
                status: "open",
                isRoutine: false,
                isSuggested: false,
                areaId: null,
              },
            },
          ]
        : [];
    const relatedContext = (ownerUserId: string): SemanticRetrievalResult[] =>
      ownerUserId === OWNER
        ? [
            {
              recordKind: "memory",
              recordId: "related-filter-context",
              visibilityChoice: "only_me",
              visibilityLabel: "Only me",
              relatedPersonId: null,
              relatedPersonDisplayName: null,
              snippet: "Replacement filters are appliance maintenance",
              similarity: 0.78,
              trustLevel: "confirmed_fact",
              sensitivity: "normal",
              sourceRefs: [{ kind: "memory", id: "related-filter-context" }],
              routing: {
                personId: null,
                recordKind: "memory",
                recordId: "related-filter-context",
              },
              generalAction: null,
            },
          ]
        : [];
    const assetSearch = createAssetSearch(
      createInMemoryAssetSearchStore({ assets: [asset], memories }),
      {
        async embedText(input) {
          return { vector: themedVector(input.text), model: input.model, version: input.version };
        },
      },
      { model: "phase-seven-test", version: "v1" },
    );
    const recall = createGlobalRecall({
      searchRelationshipExact: async (input) => exactAction(input.ownerUserId),
      searchRelationshipRelated: async (input) => relatedContext(input.ownerUserId),
      searchAssets: async (input) => ({
        ...(await assetSearch.searchAssetsWithStatus(input)),
        semanticAvailable: false,
      }),
      searchSavedItemsExact: (input) => savedItems.searchSavedItems(input),
      searchSavedItemsRelated: async () => [],
      listFollowups: async () => [],
      readCalendar: async () => ({ connected: false, result: null }),
    });
    const recalled = await recall.search({ ownerUserId: OWNER, query: "filter" });
    expect(new Set(recalled.results.map((result) => result.family))).toEqual(
      new Set(["general_action", "asset_memory", "saved_item", "relationship_context"]),
    );
    const firstRelated = recalled.results.findIndex((result) => result.match.kind === "related");
    expect(
      recalled.results.slice(0, firstRelated).every((result) => result.match.kind === "exact"),
    ).toBe(true);
    expect(
      recalled.results.every(
        (result) => result.href.startsWith("/") && result.grounding.length > 0,
      ),
    ).toBe(true);
    expect(recalled.limitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "assets",
          message: expect.stringMatching(/Related Asset matches.*unavailable/i),
        }),
      ]),
    );
    await expect(recall.search({ ownerUserId: OUTSIDER, query: "filter" })).resolves.toMatchObject({
      results: [],
    });
  });
});
