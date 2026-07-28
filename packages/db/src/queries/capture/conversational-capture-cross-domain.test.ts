import { describe, expect, it, vi } from "vitest";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemorySavedItemLifecycleStore } from "../saved-items";
import { createConversationalCapture } from "./conversational-capture";
import { createCaptureVisibilityResolver } from "./conversational-capture/visibility";

async function capturedAssetReview(input: { name: string; sourceRecordId: string }) {
  return actionMutationOutcome({
    asset: { id: "asset-filter", name: input.name, status: "suggested" as const },
    group: { id: "review-filter", sourceRecordId: input.sourceRecordId },
    component: {
      type: "asset_review_group" as const,
      groupId: "review-filter",
      assetId: "asset-filter",
      sourceRecordId: input.sourceRecordId,
    },
    duplicateCandidates: [],
  });
}

function actionMutationOutcome<T>(result: T) {
  return { result, affectedScopes: [] };
}

describe("cross-domain conversational Capture", () => {
  it("persists an explicitly grouped Action and open question against one source", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const createGeneralAction = vi
      .fn()
      .mockImplementation(async (input) => actionMutationOutcome({ ...input, status: "open" }));
    const capture = createConversationalCapture(store, {
      createGeneralAction,
      ownerTimeZone: async () => "America/Chicago",
    });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "phase-seven-filter-journey",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText:
        "Remind me to replace the kitchen refrigerator filter on August 21 with an alert one week before; and also save an open question: Where should I buy the replacement filter? Bring it back on August 14",
      surface: "global_capture",
    });

    expect(result.confirmation).toMatchObject({
      destination: "Grouped",
      groundedBySourceRecordId: result.sourceRecord.id,
      outcomes: [
        { destination: "Actions", groundedBySourceRecordId: result.sourceRecord.id },
        { destination: "Saved Items", groundedBySourceRecordId: result.sourceRecord.id },
      ],
    });
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        kind: "general_action",
        reminderSchedule: { kind: "relative", leadMinutes: 10_080 },
      }),
      expect.objectContaining({
        kind: "saved_item",
        savedItem: expect.objectContaining({
          kind: "open_question",
          title: "Where should I buy the replacement filter?",
          bringBackAt: new Date("2026-08-14T14:00:00.000Z"),
          sourceRecordId: result.sourceRecord.id,
        }),
      }),
    ]);
    expect(createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRecordId: result.sourceRecord.id }),
    );
  });

  it("creates a minimal Person only for explicit add intent and attaches the shared evidence", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const personScopes = [
      { kind: "owner-collection" as const, collection: "people" as const, ownerUserId: "owner-1" },
      {
        kind: "viewer-entity" as const,
        entity: "person" as const,
        entityId: "person-priya",
        viewerUserId: "owner-1",
      },
      { kind: "visible-entity" as const, entity: "person" as const, entityId: "person-priya" },
    ];
    const resolveOrCreateAndLinkPerson = vi.fn().mockImplementation(async (input) => ({
      person: { id: "person-priya", displayName: input.displayName },
      created: true,
      sourceRecord: await store.getSourceRecord({
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
      }),
    }));
    const capture = createConversationalCapture(store, { resolveOrCreateAndLinkPerson });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "add-priya",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Add Priya",
      surface: "global_capture",
    });

    expect(resolveOrCreateAndLinkPerson).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      sourceRecordId: result.sourceRecord.id,
      displayName: "Priya",
      role: "primary",
    });
    expect(result).toMatchObject({
      affectedScopes: personScopes,
      person: { id: "person-priya", displayName: "Priya" },
      confirmation: {
        destination: "People",
        groundedBySourceRecordId: result.sourceRecord.id,
        interpreted: { displayName: "Priya", scope: "Only me" },
      },
    });
  });

  it("uses the approved-memory contract for explicit Memory intent and the same source", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const createApprovedMemory = vi.fn().mockResolvedValue(
      actionMutationOutcome({
        id: "memory-priya",
        status: "approved",
        sourceRecordId: "filled-by-expectation",
        personId: "person-priya",
      }),
    );
    const capture = createConversationalCapture(store, {
      createApprovedMemory,
      searchPeople: vi.fn().mockResolvedValue([{ id: "person-priya", displayName: "Priya" }]),
    });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "remember-priya",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Remember that Priya prefers oat milk",
      surface: "eve",
    });

    expect(createApprovedMemory).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      personId: "person-priya",
      content: "Priya prefers oat milk",
      sourceRecordId: result.sourceRecord.id,
      scope: "private",
      householdId: null,
      selectedUserIds: [],
    });
    expect(result.confirmation).toMatchObject({
      destination: "Memories",
      groundedBySourceRecordId: result.sourceRecord.id,
      interpreted: { person: "Priya", authority: "Approved", scope: "Only me" },
    });
  });

  it("preserves an inherited selected audience across shared source and Memory writes", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const household = await seedHouseholdWithMembers(store, {
      ownerUserId: "owner-1",
      members: [
        ["owner-1", "owner"],
        ["member-1", "member"],
      ],
    });
    const createApprovedMemory = vi.fn().mockResolvedValue(
      actionMutationOutcome({
        id: "memory-priya",
        status: "approved",
        sourceRecordId: "filled-by-expectation",
        personId: "person-priya",
      }),
    );
    const capture = createConversationalCapture(store, {
      createApprovedMemory,
      searchPeople: vi.fn().mockResolvedValue([{ id: "person-priya", displayName: "Priya" }]),
      resolveVisibility: createCaptureVisibilityResolver({
        listMemberships: store.listActiveHouseholdMembershipsForUser,
        listMembers: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await capture.capture({
      authority: "explicit",
      contextVisibility: {
        scope: "shared",
        householdId: household.id,
        selectedUserIds: ["member-1"],
        label: "Alex",
      },
      interactionId: "remember-priya-shared",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Remember that Priya prefers oat milk",
      surface: "eve",
    });

    expect(result.sourceRecord).toMatchObject({ scope: "shared", householdId: household.id });
    expect(createApprovedMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "shared",
        householdId: household.id,
        selectedUserIds: ["member-1"],
      }),
    );
    expect(result.confirmation).toMatchObject({ interpreted: { scope: "Alex" } });
    await expect(
      store.listHouseholdRecordShares({
        householdId: household.id,
        recordKind: "source_record",
        recordId: result.sourceRecord.id,
      }),
    ).resolves.toMatchObject([{ sharedWithUserId: "member-1" }]);
    await expect(
      store.listHouseholdRecordShares({
        householdId: household.id,
        recordKind: "memory",
        recordId: "memory-priya",
      }),
    ).resolves.toMatchObject([{ sharedWithUserId: "member-1" }]);
  });

  it("routes Asset facts into the existing private review and duplicate-resolution contract", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const suggestAsset = vi.fn().mockImplementation(capturedAssetReview);
    const capture = createConversationalCapture(store, { suggestAsset });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "track-filter",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Track asset refrigerator water filter: model EDR4RXD1",
      surface: "global_capture",
    });

    expect(suggestAsset).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      name: "refrigerator water filter",
      kind: "item",
      scope: "private",
      sourceRecordId: result.sourceRecord.id,
      directlyRequested: true,
      memories: [{ label: "Captured detail", notes: "model EDR4RXD1" }],
      source: "assistant",
    });
    expect(result.confirmation).toMatchObject({
      destination: "Review",
      groundedBySourceRecordId: result.sourceRecord.id,
      interpreted: {
        record: "Asset",
        name: "refrigerator water filter",
        authority: "Needs review",
        scope: "Only me",
      },
    });
  });

  it("attaches captured Asset evidence to the review group instead of approving a new Asset", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const addAssetEvidence = vi.fn().mockResolvedValue(
      actionMutationOutcome({
        id: "evidence-filter",
        reviewGroupId: "review-filter",
      }),
    );
    const suggestAsset = vi.fn().mockImplementation(async (input) =>
      actionMutationOutcome({
        asset: { id: "asset-filter", name: input.name, status: "suggested" },
        group: { id: "review-filter", sourceRecordId: input.sourceRecordId },
      }),
    );
    const capture = createConversationalCapture(store, { addAssetEvidence, suggestAsset });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "filter-evidence",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText:
        "Track asset refrigerator water filter: evidence https://example.com/filter-manual.pdf",
      surface: "global_capture",
    });

    expect(suggestAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        directlyRequested: true,
        memories: [],
        scope: "private",
        sourceRecordId: result.sourceRecord.id,
      }),
    );
    expect(addAssetEvidence).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      reviewGroupId: "review-filter",
      kind: "link",
      label: "Captured evidence",
      url: "https://example.com/filter-manual.pdf",
      scope: "private",
      sourceRecordId: result.sourceRecord.id,
      source: "assistant",
    });
  });

  it("returns the same Asset review on an exact retry", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    let persisted: {
      asset: { id: string; name: string; status: string };
      group: { id: string; sourceRecordId: string };
    } | null = null;
    const suggestAsset = vi.fn().mockImplementation(async (input) => {
      persisted = {
        asset: { id: "asset-filter", name: input.name, status: "suggested" },
        group: { id: "review-filter", sourceRecordId: input.sourceRecordId },
      };
      return actionMutationOutcome(persisted);
    });
    const capture = createConversationalCapture(store, {
      findAssetReviewBySource: vi.fn().mockImplementation(async () => persisted),
      suggestAsset,
    });
    const input = {
      authority: "explicit" as const,
      interactionId: "asset-review-retry",
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      originalText: "Track asset refrigerator water filter: model EDR4RXD1",
      surface: "global_capture" as const,
    };

    const first = await capture.capture(input);
    const retry = await capture.capture(input);

    expect(first.assetReview?.group.id).toBe("review-filter");
    expect(retry.assetReview?.group.id).toBe("review-filter");
    expect(suggestAsset).toHaveBeenCalledTimes(1);
  });

  it("creates one compact group only for explicit outcomes sharing one Source Record", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const resolveOrCreateAndLinkPerson = vi.fn().mockResolvedValue({
      person: { id: "person-priya", displayName: "Priya" },
      created: true,
    });
    const createApprovedMemory = vi.fn().mockResolvedValue(
      actionMutationOutcome({
        id: "memory-priya",
        status: "approved",
        personId: "person-priya",
      }),
    );
    const suggestAsset = vi.fn().mockImplementation(capturedAssetReview);
    const capture = createConversationalCapture(store, {
      resolveOrCreateAndLinkPerson,
      createApprovedMemory,
      searchPeople: vi.fn().mockResolvedValue([{ id: "person-priya", displayName: "Priya" }]),
      suggestAsset,
    });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "group-priya-filter",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText:
        "Add Priya; and also remember that Priya prefers oat milk; and also track asset refrigerator water filter: model EDR4RXD1",
      surface: "eve",
    });

    expect(result.confirmation).toMatchObject({
      destination: "Grouped",
      groundedBySourceRecordId: result.sourceRecord.id,
      outcomes: [{ destination: "People" }, { destination: "Memories" }, { destination: "Review" }],
    });
    expect(resolveOrCreateAndLinkPerson.mock.calls[0]?.[0].sourceRecordId).toBe(
      result.sourceRecord.id,
    );
    expect(createApprovedMemory.mock.calls[0]?.[0].sourceRecordId).toBe(result.sourceRecord.id);
    expect(suggestAsset.mock.calls[0]?.[0].sourceRecordId).toBe(result.sourceRecord.id);
  });

  it("corrects one grouped outcome through its lifecycle without mutating its siblings", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const memories = new Map<string, { id: string; status: string; sourceRecordId: string }>();
    const createApprovedMemory = vi.fn().mockImplementation(async (input) => {
      const memory = {
        id: "memory-priya",
        status: "approved",
        sourceRecordId: input.sourceRecordId,
      };
      memories.set(memory.id, memory);
      return actionMutationOutcome(memory);
    });
    const archiveMemory = vi.fn().mockImplementation(async ({ memoryId }) => {
      const memory = memories.get(memoryId);
      if (!memory) throw new Error("missing memory");
      memory.status = "archived";
      return actionMutationOutcome(memory);
    });
    const dismissAssetReview = vi.fn();
    const createGeneralAction = vi
      .fn()
      .mockImplementation(async (input) => actionMutationOutcome({ ...input, status: "open" }));
    const capture = createConversationalCapture(store, {
      archiveMemory,
      resolveOrCreateAndLinkPerson: vi.fn().mockResolvedValue({
        person: { id: "person-priya", displayName: "Priya" },
        created: true,
      }),
      createApprovedMemory,
      createGeneralAction,
      dismissAssetReview,
      getMemory: vi.fn().mockImplementation(async ({ memoryId }) => memories.get(memoryId) ?? null),
      searchPeople: vi.fn().mockResolvedValue([{ id: "person-priya", displayName: "Priya" }]),
      suggestAsset: vi.fn().mockImplementation(async (input) =>
        actionMutationOutcome({
          asset: { id: "asset-filter", name: input.name, status: "suggested" },
          group: { id: "review-filter", sourceRecordId: input.sourceRecordId },
        }),
      ),
    });
    const grouped = await capture.capture({
      authority: "explicit",
      interactionId: "correct-group-member",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText:
        "Add Priya; and also remember that Priya prefers oat milk; and also track asset refrigerator water filter: model EDR4RXD1",
      surface: "global_capture",
    });
    if (grouped.confirmation?.destination !== "Grouped") {
      throw new Error("Expected grouped confirmation.");
    }
    const memoryOutcome = grouped.confirmation.outcomes[1];
    if (memoryOutcome?.destination !== "Memories") {
      throw new Error("Expected Memory outcome.");
    }

    const corrected = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: memoryOutcome.change,
      originalText: "I need to buy oat milk",
    });

    expect(corrected).toMatchObject({
      sourceRecord: { id: grouped.sourceRecord.id },
      confirmation: { destination: "Actions", groundedBySourceRecordId: grouped.sourceRecord.id },
    });
    expect(memories.get("memory-priya")?.status).toBe("archived");
    expect(createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRecordId: grouped.sourceRecord.id }),
    );
    expect(dismissAssetReview).not.toHaveBeenCalled();
    expect(await store.listAuditLogEntries({ ownerUserId: "owner-1" })).toContainEqual(
      expect.objectContaining({
        action: "capture.reroute",
        entityId: grouped.sourceRecord.id,
        metadataJson: expect.objectContaining({ from: "Memories", to: "Actions" }),
      }),
    );
  });

  it("keeps inferred secondary outcomes typed, private, review-gated, and source-grounded", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const createGeneralAction = vi
      .fn()
      .mockImplementation(async (input) => actionMutationOutcome({ ...input, status: "open" }));
    const createApprovedMemory = vi.fn();
    const createSuggestedMemory = vi.fn().mockImplementation(async (input) =>
      actionMutationOutcome({
        id: "suggested-memory-priya",
        personId: input.personId,
        sourceRecordId: input.sourceRecordId,
        status: "suggested",
      }),
    );
    const capture = createConversationalCapture(store, {
      createApprovedMemory,
      createGeneralAction,
      createSuggestedMemory,
    });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "explicit-plus-inferred",
      inferredSuggestions: [
        {
          kind: "memory",
          personId: "person-priya",
          personName: "Priya",
          content: "Priya might prefer oat milk",
        },
      ],
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "I need to buy oat milk",
      surface: "eve",
    });

    expect(createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "private", sourceRecordId: result.sourceRecord.id }),
    );
    expect(createSuggestedMemory).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      personId: "person-priya",
      content: "Priya might prefer oat milk",
      sourceRecordId: result.sourceRecord.id,
    });
    expect(createApprovedMemory).not.toHaveBeenCalled();
    expect(result.confirmation).toMatchObject({
      destination: "Grouped",
      groundedBySourceRecordId: result.sourceRecord.id,
      outcomes: [
        { destination: "Actions", groundedBySourceRecordId: result.sourceRecord.id },
        {
          destination: "Review",
          groundedBySourceRecordId: result.sourceRecord.id,
          interpreted: {
            record: "Memory",
            authority: "Needs review",
            scope: "Only me",
          },
        },
      ],
    });
  });

  it("reroutes a newly captured minimal Person through its guarded delete lifecycle", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const person = { id: "person-priya", displayName: "Priya" };
    const personScope = {
      kind: "owner-collection" as const,
      collection: "people" as const,
      ownerUserId: "owner-1",
    };
    const deleteCapturedPerson = vi.fn().mockResolvedValue({
      result: person,
      affectedScopes: [personScope],
    });
    const assertCapturedPersonRemovable = vi.fn().mockResolvedValue(undefined);
    const createGeneralAction = vi.fn().mockImplementation(async (input) =>
      actionMutationOutcome({
        ...input,
        id: input.id,
        status: "open",
      }),
    );
    const capture = createConversationalCapture(store, {
      resolveOrCreateAndLinkPerson: vi.fn().mockResolvedValue({ person, created: true }),
      searchPeople: vi.fn().mockResolvedValue([]),
      getPerson: vi.fn().mockResolvedValue(person),
      assertCapturedPersonRemovable,
      deleteCapturedPerson,
      createGeneralAction,
    });
    const original = await capture.capture({
      authority: "explicit",
      interactionId: "person-reroute",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Add Priya",
      surface: "global_capture",
    });
    if (original.confirmation?.destination !== "People") {
      throw new Error("Expected a Person confirmation.");
    }

    const corrected = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: original.confirmation.change,
      originalText: "I need to call the dentist",
    });

    expect(original.confirmation.change).toMatchObject({ createdByCapture: true });
    expect(assertCapturedPersonRemovable).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      personId: person.id,
      sourceRecordId: original.sourceRecord.id,
    });
    expect(deleteCapturedPerson).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      personId: person.id,
      sourceRecordId: original.sourceRecord.id,
    });
    expect(corrected).toMatchObject({
      affectedScopes: [personScope],
      generalAction: { status: "open", sourceRecordId: original.sourceRecord.id },
      confirmation: { destination: "Actions" },
    });
  });

  it("unlinks an established Person without deleting it when rerouting one capture", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const person = { id: "person-priya", displayName: "Priya" };
    const unlinkCapturedPerson = vi.fn().mockResolvedValue(person);
    const deleteCapturedPerson = vi.fn();
    const createGeneralAction = vi
      .fn()
      .mockImplementation(async (input) => actionMutationOutcome({ ...input, status: "open" }));
    const capture = createConversationalCapture(store, {
      resolveOrCreateAndLinkPerson: vi.fn().mockResolvedValue({ person, created: false }),
      getPerson: vi.fn().mockResolvedValue(person),
      unlinkCapturedPerson,
      deleteCapturedPerson,
      createGeneralAction,
    });
    const original = await capture.capture({
      authority: "explicit",
      interactionId: "existing-person-reroute",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Add Priya",
      surface: "global_capture",
    });
    if (original.confirmation?.destination !== "People") {
      throw new Error("Expected a Person confirmation.");
    }

    await expect(
      capture.changeOutcome({
        actorUserId: "owner-1",
        target: original.confirmation.change,
        originalText: "I need to call the dentist",
      }),
    ).resolves.toMatchObject({ confirmation: { destination: "Actions" } });
    expect(unlinkCapturedPerson).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      personId: person.id,
      sourceRecordId: original.sourceRecord.id,
    });
    expect(deleteCapturedPerson).not.toHaveBeenCalled();
  });

  it("never widens capture visibility from plural wording", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const capture = createConversationalCapture(store);

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "plural-stays-private",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "We need a replacement refrigerator water filter",
      surface: "global_capture",
    });

    expect(result.sourceRecord.scope).toBe("private");
    expect(result.savedItem).toMatchObject({ scope: "private" });
    expect(result.confirmation).toMatchObject({
      destination: "Saved Items",
      interpreted: { visibility: "Only me" },
    });
  });

  it("replaces an edited Asset fact with a fresh review and dismisses only the mistaken group", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const groups = new Map<
      string,
      {
        asset: { id: string; name: string; status: "suggested" | "dismissed" };
        group: { id: string; sourceRecordId: string };
      }
    >();
    const suggestAsset = vi.fn().mockImplementation(async (input) => {
      const index = groups.size + 1;
      const review = {
        asset: {
          id: `asset-${index}`,
          name: input.name,
          status: "suggested" as const,
        },
        group: { id: `group-${index}`, sourceRecordId: input.sourceRecordId },
      };
      groups.set(review.group.id, review);
      return actionMutationOutcome(review);
    });
    const dismissAssetReview = vi.fn().mockImplementation(async ({ groupId }) => {
      const review = groups.get(groupId);
      if (!review) throw new Error("missing review");
      review.asset.status = "dismissed";
      return review;
    });
    const capture = createConversationalCapture(store, {
      suggestAsset,
      findAssetReviewBySource: vi
        .fn()
        .mockImplementation(async ({ sourceRecordId, assetName }) =>
          [...groups.values()].find(
            (review) =>
              review.group.sourceRecordId === sourceRecordId &&
              review.asset.name === assetName &&
              review.asset.status === "suggested",
          ),
        ),
      getAssetReview: vi
        .fn()
        .mockImplementation(async ({ groupId }) => groups.get(groupId) ?? null),
      dismissAssetReview,
    });
    const original = await capture.capture({
      authority: "explicit",
      interactionId: "asset-fact-correction",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Track asset refrigerator filter: model EDR3RXD1",
      surface: "global_capture",
    });
    if (original.confirmation?.destination !== "Review") {
      throw new Error("Expected an Asset review confirmation.");
    }

    const corrected = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: original.confirmation.change,
      originalText: "Track asset refrigerator filter: model EDR4RXD1",
    });
    const retried = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: original.confirmation.change,
      originalText: "Track asset refrigerator filter: model EDR4RXD1",
    });

    expect(corrected).toMatchObject({ assetReview: { group: { id: "group-2" } } });
    expect(retried).toMatchObject({ assetReview: { group: { id: "group-2" } } });
    expect(groups.get("group-1")?.asset.status).toBe("dismissed");
    expect(groups.get("group-2")?.asset.status).toBe("suggested");
    expect(suggestAsset).toHaveBeenCalledTimes(2);
    expect(dismissAssetReview).toHaveBeenCalledTimes(1);
  });
});
