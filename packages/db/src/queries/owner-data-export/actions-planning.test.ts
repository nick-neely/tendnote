import { describe, expect, it } from "vitest";
import type { OwnerDataExportActionsPlanningContext } from "./actions-planning";
import { generateOwnerDataExportArchive } from "./generator";
import type { OwnerDataExportRelationshipContext } from "./relationship-context";
import { readStoredZipEntries } from "./test-utils";

const ACCOUNT = {
  id: "owner-1",
  name: "Owner Example",
  email: "owner@example.com",
  accessStatus: "granted" as const,
  accessSource: "self_hosted_bootstrap",
  grantedAt: new Date("2026-08-19T12:00:00.000Z"),
};

const NOW = new Date("2026-08-19T12:00:00.000Z");

function emptyRelationshipContext(): OwnerDataExportRelationshipContext {
  return {
    people: [
      {
        id: "person-owned",
        ownerUserId: "owner-1",
        displayName: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        birthday: null,
        relationshipType: "friend",
        closenessLevel: 2,
        profileBlurb: null,
        source: "manual",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    contactMethods: [],
    memories: [
      {
        id: "memory-owned",
        personId: "person-owned",
        ownerUserId: "owner-1",
        householdId: null,
        sourceRecordId: "source-owned",
        memoryType: "context",
        content: "Ada is preparing a lecture.",
        status: "approved",
        importance: 3,
        sensitivity: "restricted",
        confidence: "high",
        scope: "private",
        approvedAt: NOW,
        dismissedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    sourceRecords: [
      {
        id: "source-owned",
        ownerUserId: "owner-1",
        householdId: null,
        sourceType: "manual",
        content: "Water filter receipt",
        rawContent: null,
        retentionPolicy: "retain",
        status: "active",
        confidence: "high",
        sensitivity: "restricted",
        scope: "private",
        importance: 3,
        metadataJson: {},
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    sourceRecordPeople: [],
    unresolvedMentions: [],
    interactions: [],
    followups: [],
    contextFacts: [],
  };
}

function planningContext(): OwnerDataExportActionsPlanningContext {
  const createdAt = new Date("2026-08-01T12:00:00.000Z");
  const updatedAt = new Date("2026-08-18T12:00:00.000Z");
  return {
    generalActions: [
      {
        id: "action-owned",
        ownerUserId: "owner-1",
        ownership: "member_owned",
        responsibilityHolderUserId: null,
        occurrenceVersion: 2,
        title: "Replace the water filter",
        notes: "Use the model from the receipt.",
        links: [{ url: "https://example.com/filter", label: "Filter" }],
        status: "deferred",
        dueAt: new Date("2026-08-20T12:00:00.000Z"),
        deferUntil: new Date("2026-08-21T12:00:00.000Z"),
        recurrence: { interval: 6, unit: "month" },
        sourceRecordId: "source-owned",
        areaId: "area-owned",
        scope: "shared",
        householdId: "household-1",
        assetHints: [{ label: "refrigerator water filter" }],
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        completedAt: null,
        createdAt,
        updatedAt,
      },
      {
        id: "action-household-native",
        ownerUserId: "owner-1",
        ownership: "household_native",
        responsibilityHolderUserId: "owner-1",
        occurrenceVersion: 1,
        title: "Household chore",
        notes: null,
        links: [],
        status: "open",
        dueAt: null,
        deferUntil: null,
        recurrence: null,
        sourceRecordId: null,
        areaId: null,
        scope: "household",
        householdId: "household-1",
        assetHints: [],
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        completedAt: null,
        createdAt,
        updatedAt,
      },
    ],
    generalActionAreas: [
      {
        id: "area-owned",
        ownerUserId: "owner-1",
        name: "Home",
        sortOrder: 0,
        archivedAt: new Date("2026-08-17T12:00:00.000Z"),
        createdAt,
        updatedAt,
      },
    ],
    generalActionPeople: [
      {
        id: "action-person-link",
        generalActionId: "action-owned",
        personId: "person-owned",
        createdAt,
      },
    ],
    generalActionAssets: [
      {
        id: "action-asset-link",
        createdByUserId: "owner-1",
        generalActionId: "action-owned",
        assetId: "asset-owned",
        hintLabel: "refrigerator water filter",
        assetMemoryId: null,
        createdAt,
      },
    ],
    generalActionEvents: [
      {
        id: "action-event",
        generalActionId: "action-owned",
        ownerUserId: "owner-1",
        kind: "deferred",
        actorUserId: "owner-1",
        detailJson: {
          previousStatus: "open",
          status: "deferred",
          deferUntil: "2026-08-21T12:00:00.000Z",
          secretSession: "omit",
        },
        createdAt: updatedAt,
      },
      {
        id: "action-event-routine-completed",
        generalActionId: "action-owned",
        ownerUserId: "owner-1",
        kind: "completed",
        actorUserId: "owner-1",
        detailJson: {
          previousStatus: "open",
          status: "open",
          rolledForward: true,
          previousDueAt: "2026-02-01T12:00:00.000Z",
          nextDueAt: "2026-08-01T12:00:00.000Z",
          occurrenceVersion: 2,
        },
        createdAt: new Date("2026-08-18T12:01:00.000Z"),
      },
      {
        id: "action-event-routine-resumed",
        generalActionId: "action-owned",
        ownerUserId: "owner-1",
        kind: "resumed",
        actorUserId: "owner-1",
        detailJson: {
          previousStatus: "paused",
          status: "open",
          rolledForward: true,
          previousDueAt: "2026-08-01T12:00:00.000Z",
          nextDueAt: "2027-02-01T12:00:00.000Z",
        },
        createdAt: new Date("2026-08-18T12:02:00.000Z"),
      },
    ],
    savedItems: [],
    savedItemEvents: [],
    savedItemOutcomes: [],
    messageDrafts: [],
    giftPlans: [],
    giftIdeas: [],
    giftPlanEvents: [],
    recordShares: [],
    sourceRecordIds: ["source-owned"],
    personIds: ["person-owned"],
  };
}

function resource(entries: Map<string, string>, path: string) {
  const parsed = JSON.parse(entries.get(path) ?? "null") as { records: unknown[] } | null;
  if (!parsed) throw new Error(`Missing ${path}`);
  return parsed.records;
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (!value) throw new Error("Expected fixture record.");
  return value;
}

describe("owner actions and planning export", () => {
  it("exports member-owned General Actions, Areas, links, and lifecycle history", async () => {
    const context = planningContext();
    const ownedAction = first(context.generalActions);
    context.generalActions.push({
      ...ownedAction,
      id: "action-other-owner",
      ownerUserId: "owner-2",
      sourceRecordId: null,
      areaId: null,
    });
    context.generalActionAreas.push({
      ...first(context.generalActionAreas),
      id: "area-other-owner",
      ownerUserId: "owner-2",
    });
    const result = await generateOwnerDataExportArchive({
      ownerUserId: "owner-1",
      account: ACCOUNT,
      now: NOW,
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
      relationshipContext: emptyRelationshipContext(),
      actionsPlanningContext: context,
    });
    const entries = readStoredZipEntries(result.bytes);
    const manifest = JSON.parse(entries.get("manifest.json") ?? "null") as {
      includedFamilies: string[];
    };

    expect(manifest.includedFamilies).toEqual(
      expect.arrayContaining([
        "General Actions",
        "General Action Areas",
        "Saved Items",
        "Message Drafts",
        "Gift Plans",
      ]),
    );
    expect(resource(entries, "resources/actions/general-actions-v1.json")).toEqual([
      expect.objectContaining({
        id: "action-owned",
        status: "deferred",
        sourceRecordId: "source-owned",
        areaId: "area-owned",
        deferUntil: "2026-08-21T12:00:00.000Z",
        recurrence: { interval: 6, unit: "month" },
      }),
    ]);
    expect(resource(entries, "resources/actions/general-action-areas-v1.json")).toEqual([
      expect.objectContaining({ id: "area-owned", archivedAt: "2026-08-17T12:00:00.000Z" }),
    ]);
    expect(resource(entries, "resources/actions/general-action-people-v1.json")).toEqual([
      expect.objectContaining({ personId: "person-owned" }),
    ]);
    expect(resource(entries, "resources/actions/general-action-assets-v1.json")).toEqual([
      expect.objectContaining({ assetId: "asset-owned" }),
    ]);
    expect(resource(entries, "resources/actions/general-action-events-v1.json")).toEqual([
      expect.objectContaining({
        kind: "deferred",
        detailJson: expect.objectContaining({ deferUntil: "2026-08-21T12:00:00.000Z" }),
      }),
      expect.objectContaining({
        kind: "completed",
        detailJson: expect.objectContaining({ rolledForward: true }),
      }),
      expect.objectContaining({
        kind: "resumed",
        detailJson: expect.objectContaining({ rolledForward: true }),
      }),
    ]);
    expect(new TextDecoder().decode(result.bytes)).not.toContain("secretSession");
  });

  it("exports Saved Items, grounded timing and outcome links, internal drafts, and Gift Plans", async () => {
    const context = planningContext();
    const createdAt = new Date("2026-08-01T12:00:00.000Z");
    const updatedAt = new Date("2026-08-18T12:00:00.000Z");
    context.savedItems.push(
      {
        id: "saved-owned",
        ownerUserId: "owner-1",
        ownership: "member_owned",
        kind: "link",
        title: "Filter guide",
        content: "A useful guide.",
        url: "https://example.com/guide",
        status: "archived",
        bringBackAt: new Date("2026-09-01T12:00:00.000Z"),
        bringBackTimeSemantics: "instant",
        sourceRecordId: "source-owned",
        scope: "private",
        householdId: null,
        resolvedAt: null,
        resolutionReason: null,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        version: 3,
        createdAt,
        updatedAt,
      },
      {
        id: "saved-household-native",
        ownerUserId: null,
        ownership: "household_native",
        kind: "note",
        title: "Household item",
        content: "Exclude this.",
        url: null,
        status: "active",
        bringBackAt: null,
        bringBackTimeSemantics: "date_only",
        sourceRecordId: "source-owned",
        scope: "household",
        householdId: "household-1",
        resolvedAt: null,
        resolutionReason: null,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        version: 1,
        createdAt,
        updatedAt,
      },
    );
    context.savedItemEvents.push({
      id: "saved-event",
      savedItemId: "saved-owned",
      ownerUserId: "owner-1",
      kind: "promoted",
      actorUserId: "owner-1",
      detailJson: { destinationKind: "general_action", destinationRecordId: "action-owned" },
      createdAt: updatedAt,
    });
    context.savedItemOutcomes.push({
      id: "saved-outcome",
      savedItemId: "saved-owned",
      destinationKind: "general_action",
      destinationRecordId: "action-owned",
      idempotencyKey: "promotion-1",
      createdAt: updatedAt,
    });
    context.messageDrafts.push({
      id: "draft-owned",
      personId: "person-owned",
      ownerUserId: "owner-1",
      channel: "email",
      purpose: "check_in",
      body: "How is the lecture going?",
      status: "approved",
      sourceRefs: [
        {
          kind: "source_record",
          id: "source-owned",
          label: "Lecture note",
          trust: "logged_context",
        },
        {
          kind: "approved_memory",
          id: "memory-owned",
          label: "Lecture context",
          trust: "confirmed_fact",
        },
      ],
      createdAt,
      updatedAt,
    });
    context.giftPlans.push({
      id: "gift-plan-owned",
      ownerUserId: "owner-1",
      subjectName: "Ada",
      occasion: "Birthday",
      occasionOn: new Date("2026-12-10T12:00:00.000Z"),
      subjectPersonId: "person-owned",
      surpriseSubjectUserId: "owner-2",
      status: "celebrated",
      scope: "shared",
      householdId: "household-1",
      lastActorUserId: "owner-2",
      revision: 4,
      createdAt,
      updatedAt,
    });
    context.giftIdeas.push({
      id: "gift-idea-contribution",
      giftPlanId: "gift-plan-owned",
      contributorUserId: "owner-2",
      title: "A fountain pen",
      note: "She mentioned this.",
      url: "https://example.com/pen",
      claimedByUserId: "owner-2",
      claimedAt: updatedAt,
      lastActorUserId: "owner-2",
      revision: 2,
      createdAt,
      updatedAt,
    });
    context.giftPlanEvents.push({
      id: "gift-event",
      giftPlanId: "gift-plan-owned",
      kind: "idea_claimed",
      actorUserId: "owner-2",
      detailJson: { giftIdeaId: "gift-idea-contribution" },
      createdAt: updatedAt,
    });
    context.recordShares.push(
      {
        id: "share-action",
        householdId: "household-1",
        recordKind: "general_action",
        recordId: "action-owned",
        sharedWithUserId: "owner-2",
        sharedByUserId: "owner-1",
        createdAt,
      },
      {
        id: "share-saved",
        householdId: "household-1",
        recordKind: "saved_item",
        recordId: "saved-owned",
        sharedWithUserId: "owner-2",
        sharedByUserId: "owner-1",
        createdAt,
      },
      {
        id: "share-gift",
        householdId: "household-1",
        recordKind: "gift_plan",
        recordId: "gift-plan-owned",
        sharedWithUserId: "owner-2",
        sharedByUserId: "owner-1",
        createdAt,
      },
    );
    context.savedItems.push({
      ...first(context.savedItems),
      id: "saved-other-owner",
      ownerUserId: "owner-2",
      sourceRecordId: "source-owned",
    });
    context.giftPlans.push({
      ...first(context.giftPlans),
      id: "gift-plan-other-owner",
      ownerUserId: "owner-2",
      subjectPersonId: null,
    });

    const result = await generateOwnerDataExportArchive({
      ownerUserId: "owner-1",
      account: ACCOUNT,
      now: NOW,
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
      relationshipContext: emptyRelationshipContext(),
      actionsPlanningContext: context,
    });
    const entries = readStoredZipEntries(result.bytes);
    expect(resource(entries, "resources/saved-items/saved-items-v1.json")).toEqual([
      expect.objectContaining({
        id: "saved-owned",
        status: "archived",
        bringBackAt: "2026-09-01T12:00:00.000Z",
        sourceRecordId: "source-owned",
      }),
    ]);
    expect(resource(entries, "resources/saved-items/saved-item-outcomes-v1.json")).toEqual([
      expect.objectContaining({ destinationRecordId: "action-owned" }),
    ]);
    expect(resource(entries, "resources/drafts/message-drafts-v1.json")).toEqual([
      expect.objectContaining({
        id: "draft-owned",
        status: "approved",
        sourceRefs: expect.arrayContaining([
          expect.objectContaining({ kind: "approved_memory", trust: "confirmed_fact" }),
        ]),
      }),
    ]);
    expect(resource(entries, "resources/gift-plans/gift-plans-v1.json")).toEqual([
      expect.objectContaining({ id: "gift-plan-owned", status: "celebrated", scope: "shared" }),
    ]);
    expect(resource(entries, "resources/gift-plans/gift-plan-ideas-v1.json")).toEqual([
      expect.objectContaining({ contributorUserId: "owner-2", url: "https://example.com/pen" }),
    ]);
    expect(resource(entries, "resources/sharing/record-shares-v1.json")).toHaveLength(3);
    const manifest = JSON.parse(entries.get("manifest.json") ?? "null") as {
      resources: Array<{ path: string; sensitivity?: string }>;
    };
    expect(
      manifest.resources.find((item) => item.path === "resources/saved-items/saved-items-v1.json"),
    ).toMatchObject({ sensitivity: "restricted" });
    expect(new TextDecoder().decode(result.bytes)).not.toContain("saved-household-native");
    expect(new TextDecoder().decode(result.bytes)).not.toContain("saved-other-owner");
    expect(new TextDecoder().decode(result.bytes)).not.toContain("gift-plan-other-owner");
  });

  it("fails closed when owner-owned grounding points outside the exported owner graph", async () => {
    const context = planningContext();
    context.generalActions[0] = {
      ...first(context.generalActions),
      sourceRecordId: "source-other-owner",
    };
    await expect(
      generateOwnerDataExportArchive({
        ownerUserId: "owner-1",
        account: ACCOUNT,
        now: NOW,
        expiresAt: new Date("2026-08-20T12:00:00.000Z"),
        relationshipContext: emptyRelationshipContext(),
        actionsPlanningContext: context,
      }),
    ).rejects.toThrow("action-owned");
  });

  it.each([
    {
      name: "a General Action source",
      mutate(context: OwnerDataExportActionsPlanningContext) {
        context.generalActions[0] = {
          ...first(context.generalActions),
          sourceRecordId: "source-foreign",
        };
      },
      expected: "General Action action-owned references source record source-foreign",
    },
    {
      name: "a draft Person",
      mutate(context: OwnerDataExportActionsPlanningContext) {
        context.messageDrafts.push({
          id: "draft-foreign-person",
          personId: "person-foreign",
          ownerUserId: "owner-1",
          channel: "email",
          purpose: "check_in",
          body: "Private draft",
          status: "draft",
          sourceRefs: [],
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      expected: "message draft draft-foreign-person references Person person-foreign",
    },
    {
      name: "a draft source reference",
      mutate(context: OwnerDataExportActionsPlanningContext) {
        context.messageDrafts.push({
          id: "draft-foreign-source",
          personId: "person-owned",
          ownerUserId: "owner-1",
          channel: "email",
          purpose: "check_in",
          body: "Private draft",
          status: "draft",
          sourceRefs: [
            {
              kind: "source_record",
              id: "source-foreign",
              label: "Foreign context",
              trust: "logged_context",
            },
          ],
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      expected: "message draft draft-foreign-source references source record source-foreign",
    },
    {
      name: "a Gift Plan subject",
      mutate(context: OwnerDataExportActionsPlanningContext) {
        context.giftPlans.push({
          id: "gift-plan-foreign-subject",
          ownerUserId: "owner-1",
          subjectName: "Foreign person",
          occasion: "Birthday",
          occasionOn: null,
          subjectPersonId: "person-foreign",
          surpriseSubjectUserId: null,
          status: "active",
          scope: "private",
          householdId: null,
          lastActorUserId: "owner-1",
          revision: 0,
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      expected: "Gift Plan gift-plan-foreign-subject references Person person-foreign",
    },
  ])("uses the filtered relationship graph for $name", async ({ mutate, expected }) => {
    const relationshipContext = emptyRelationshipContext();
    relationshipContext.people.push({
      ...first(relationshipContext.people),
      id: "person-foreign",
      ownerUserId: "owner-2",
    });
    relationshipContext.sourceRecords.push({
      ...first(relationshipContext.sourceRecords),
      id: "source-foreign",
      ownerUserId: "owner-2",
    });

    const context = planningContext();
    // Simulate a broad future adapter: these candidate ids must never overrule
    // the exact graph emitted by the owner-filtered relationship extension.
    context.sourceRecordIds = ["source-owned", "source-foreign"];
    context.personIds = ["person-owned", "person-foreign"];
    mutate(context);

    await expect(
      generateOwnerDataExportArchive({
        ownerUserId: "owner-1",
        account: ACCOUNT,
        now: NOW,
        expiresAt: new Date("2026-08-20T12:00:00.000Z"),
        relationshipContext,
        actionsPlanningContext: context,
      }),
    ).rejects.toThrow(expected);
  });

  it.each([
    {
      name: "the valid but ungrounded brief_item kind",
      ref: {
        kind: "brief_item",
        id: "brief-item-owned",
        label: "Morning brief entry",
        trust: "entry_point",
      },
      expectedKind: "brief_item",
    },
    {
      name: "an unknown runtime kind",
      ref: {
        kind: "provider_message",
        id: "provider-message-1",
        label: "Provider-shaped input",
        trust: "logged_context",
      },
      expectedKind: "provider_message",
    },
    {
      name: "a malformed runtime reference with no kind",
      ref: {
        id: "malformed-1",
        label: "Malformed input",
        trust: "logged_context",
      },
      expectedKind: "undefined",
    },
  ])("fails closed for $name", async ({ ref, expectedKind }) => {
    const context = planningContext();
    context.messageDrafts.push({
      id: "draft-unsupported-ref",
      personId: "person-owned",
      ownerUserId: "owner-1",
      channel: "email",
      purpose: "check_in",
      body: "Private draft",
      status: "draft",
      sourceRefs: [ref as never],
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(
      generateOwnerDataExportArchive({
        ownerUserId: "owner-1",
        account: ACCOUNT,
        now: NOW,
        expiresAt: new Date("2026-08-20T12:00:00.000Z"),
        relationshipContext: emptyRelationshipContext(),
        actionsPlanningContext: context,
      }),
    ).rejects.toThrow(
      `message draft draft-unsupported-ref has unsupported source reference kind ${expectedKind}`,
    );
  });

  it("keeps every supported lifecycle state instead of applying proactive-view filters", async () => {
    const context = planningContext();
    const action = first(context.generalActions);
    const saved = {
      id: "saved-lifecycle-active",
      ownerUserId: "owner-1",
      ownership: "member_owned" as const,
      kind: "note" as const,
      title: "Lifecycle item",
      content: "Keep this history.",
      url: null,
      status: "active" as const,
      bringBackAt: null,
      bringBackTimeSemantics: "date_only" as const,
      sourceRecordId: "source-owned",
      scope: "private" as const,
      householdId: null,
      resolvedAt: null,
      resolutionReason: null,
      createdByUserId: "owner-1",
      lastActorUserId: "owner-1",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    context.generalActions.push(
      ...(
        ["open", "completed", "dismissed", "archived", "paused", "suggested", "ignored"] as const
      ).map((status, index) => ({
        ...action,
        id: `action-lifecycle-${status}`,
        status,
        sourceRecordId: null,
        areaId: null,
        occurrenceVersion: index,
      })),
    );
    context.savedItems.push(saved, {
      ...saved,
      id: "saved-lifecycle-archived",
      status: "archived",
    });
    context.messageDrafts.push(
      ...(["draft", "approved", "dismissed", "sent_manually"] as const).map((status) => ({
        id: `draft-lifecycle-${status}`,
        personId: "person-owned",
        ownerUserId: "owner-1",
        channel: "text" as const,
        purpose: "other" as const,
        body: `Draft ${status}`,
        status,
        sourceRefs: [],
        createdAt: NOW,
        updatedAt: NOW,
      })),
    );
    context.giftPlans.push(
      ...(["active", "celebrated", "archived"] as const).map((status) => ({
        id: `gift-plan-lifecycle-${status}`,
        ownerUserId: "owner-1",
        subjectName: "Ada",
        occasion: "Birthday",
        occasionOn: null,
        subjectPersonId: null,
        surpriseSubjectUserId: null,
        status,
        scope: "private" as const,
        householdId: null,
        lastActorUserId: "owner-1",
        revision: 0,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    );

    const result = await generateOwnerDataExportArchive({
      ownerUserId: "owner-1",
      account: ACCOUNT,
      now: NOW,
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
      relationshipContext: emptyRelationshipContext(),
      actionsPlanningContext: context,
    });
    const entries = readStoredZipEntries(result.bytes);
    const statuses = (path: string) =>
      resource(entries, path)
        .map((record) => (record as { status: string }).status)
        .sort();
    expect(statuses("resources/actions/general-actions-v1.json")).toEqual(
      [
        "open",
        "deferred",
        "completed",
        "dismissed",
        "archived",
        "paused",
        "suggested",
        "ignored",
      ].sort(),
    );
    expect(statuses("resources/saved-items/saved-items-v1.json")).toEqual(
      ["active", "archived"].sort(),
    );
    expect(statuses("resources/drafts/message-drafts-v1.json")).toEqual(
      ["draft", "approved", "dismissed", "sent_manually"].sort(),
    );
    expect(statuses("resources/gift-plans/gift-plans-v1.json")).toEqual(
      ["active", "celebrated", "archived"].sort(),
    );
  });
});
