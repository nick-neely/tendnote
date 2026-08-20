import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerDataExportActionsPlanningContext } from "./actions-planning";
import type { OwnerDataExportAssetsContext } from "./assets";
import { generateOwnerDataExportArchive } from "./generator";
import {
  createInMemoryOwnerDataExportArtifactStore,
  createInMemoryOwnerDataExportJobStore,
} from "./in-memory-store";
import { enqueueAndTriggerOwnerDataExportJob, expireOwnerDataExportArtifacts } from "./processor";
import type { OwnerDataExportRelationshipContext } from "./relationship-context";
import { readStoredZipEntries, readStoredZipEntryBytes } from "./test-utils";

const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";
const HOUSEHOLD = "household-1";
const NOW = new Date("2026-08-19T12:00:00.000Z");
const EXPIRES = new Date("2026-08-20T12:00:00.000Z");

const ACCOUNT = {
  id: OWNER,
  name: "Owner Example",
  email: "owner@example.com",
  accessStatus: "granted" as const,
  accessSource: "self_hosted_bootstrap",
  grantedAt: NOW,
};

function asRecord<T>(value: object) {
  return value as T;
}

function date(value: string) {
  return new Date(value);
}

function jsonResource(entries: Map<string, string>, path: string) {
  const parsed = JSON.parse(entries.get(path) ?? "null") as { records: unknown[] } | null;
  if (!parsed) throw new Error(`Missing ${path}`);
  return parsed.records;
}

// fallow-ignore-next-line complexity
function relationshipContext(): OwnerDataExportRelationshipContext {
  const person = {
    id: "person-owned",
    ownerUserId: OWNER,
    displayName: "Ada Lovelace",
    firstName: "Ada",
    lastName: "Lovelace",
    birthday: "--12-10",
    relationshipType: "friend",
    closenessLevel: 2,
    profileBlurb: "Mathematician",
    source: "manual",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const source = {
    id: "source-owned-active",
    ownerUserId: OWNER,
    householdId: null,
    sourceType: "manual",
    content: "Ada is preparing a lecture.",
    rawContent: "provider payload must not be exported",
    retentionPolicy: "retain",
    status: "active",
    confidence: "high",
    sensitivity: "restricted",
    scope: "private",
    importance: 4,
    metadataJson: {
      captureSurface: "account",
      providerToken: "operational-secret",
      interactionId: "operational-id",
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  const sourceRecords = [
    source,
    ...(["pending_resolution", "dismissed", "archived"] as const).map((status) => ({
      ...source,
      id: `source-owned-${status}`,
      content: `Source record ${status}`,
      status,
    })),
    {
      ...source,
      id: "source-other-owner",
      ownerUserId: OTHER_OWNER,
      householdId: HOUSEHOLD,
      content: "Other member content must not be exported.",
      sensitivity: "normal",
      scope: "shared",
    },
  ].map((value) => asRecord<OwnerDataExportRelationshipContext["sourceRecords"][number]>(value));

  const memorySource = "source-owned-active";
  const memory = {
    id: "memory-owned-approved",
    personId: person.id,
    ownerUserId: OWNER,
    householdId: null,
    sourceRecordId: memorySource,
    memoryType: "context",
    content: "Ada is preparing a lecture.",
    status: "approved",
    importance: 4,
    sensitivity: "restricted",
    confidence: "high",
    scope: "private",
    approvedAt: NOW,
    dismissedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const memories = [
    memory,
    ...(["suggested", "dismissed", "archived"] as const).map((status) => ({
      ...memory,
      id: `memory-owned-${status}`,
      content: `Memory ${status}`,
      status,
      approvedAt: null,
      dismissedAt: status === "dismissed" ? NOW : null,
    })),
    {
      ...memory,
      id: "memory-other-owner",
      ownerUserId: OTHER_OWNER,
      householdId: HOUSEHOLD,
      content: "Other member memory must not be exported.",
      sensitivity: "normal",
      scope: "shared",
    },
  ].map((value) => asRecord<OwnerDataExportRelationshipContext["memories"][number]>(value));

  const followup = {
    id: "followup-owned-open",
    personId: person.id,
    ownerUserId: OWNER,
    reason: "Ask about the lecture",
    dueAt: date("2026-08-20T12:00:00.000Z"),
    status: "open",
    cadence: null,
    sourceRecordId: memorySource,
    lastPromptedAt: null,
    householdId: null,
    scope: "private",
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const followups = [
    followup,
    ...(["suggested", "snoozed", "completed", "dismissed", "archived"] as const).map((status) => ({
      ...followup,
      id: `followup-owned-${status}`,
      status,
    })),
    {
      ...followup,
      id: "followup-other-owner",
      ownerUserId: OTHER_OWNER,
      householdId: HOUSEHOLD,
      scope: "shared",
      reason: "Other member follow-up",
    },
  ].map((value) => asRecord<OwnerDataExportRelationshipContext["followups"][number]>(value));

  const contextFact = {
    id: "context-owned-suggested",
    subject: { kind: "self", userId: OWNER },
    category: "work",
    content: "I work on privacy-preserving systems.",
    lifecycle: "suggested",
    sensitivity: "sensitive",
    provenance: { channel: "account", origin: "direct", sourceRecordId: memorySource },
    suggestionEvidence: "A reviewable suggestion",
    creatorUserId: OWNER,
    lastActorUserId: OWNER,
    reviewedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  return {
    people: [
      asRecord<OwnerDataExportRelationshipContext["people"][number]>(person),
      asRecord<OwnerDataExportRelationshipContext["people"][number]>({
        ...person,
        id: "person-other-owner",
        ownerUserId: OTHER_OWNER,
        displayName: "Grace Hopper",
      }),
    ],
    contactMethods: [
      asRecord<OwnerDataExportRelationshipContext["contactMethods"][number]>({
        id: "contact-owned",
        personId: person.id,
        type: "email",
        value: "ada@example.com",
        displayValue: "ada@example.com",
        normalizedValue: "ada@example.com",
        isPrimary: true,
        source: "manual",
        createdAt: NOW,
        updatedAt: NOW,
      }),
      asRecord<OwnerDataExportRelationshipContext["contactMethods"][number]>({
        id: "contact-other-owner",
        personId: "person-other-owner",
        type: "email",
        value: "grace@example.com",
        displayValue: "grace@example.com",
        normalizedValue: "grace@example.com",
        isPrimary: true,
        source: "manual",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    memories,
    sourceRecords,
    sourceRecordPeople: [
      asRecord<OwnerDataExportRelationshipContext["sourceRecordPeople"][number]>({
        id: "source-person-owned",
        sourceRecordId: memorySource,
        personId: person.id,
        role: "primary",
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportRelationshipContext["sourceRecordPeople"][number]>({
        id: "source-person-other",
        sourceRecordId: "source-other-owner",
        personId: "person-other-owner",
        role: "mentioned",
        createdAt: NOW,
      }),
    ],
    unresolvedMentions: [
      asRecord<OwnerDataExportRelationshipContext["unresolvedMentions"][number]>({
        id: "mention-owned",
        sourceRecordId: memorySource,
        mentionText: "Ada",
        candidatePersonIds: [person.id, "person-other-owner"],
        status: "unresolved",
        resolvedPersonId: person.id,
        createdAt: NOW,
        resolvedAt: null,
      }),
    ],
    interactions: [
      asRecord<OwnerDataExportRelationshipContext["interactions"][number]>({
        id: "interaction-owned",
        personId: person.id,
        ownerUserId: OWNER,
        interactionType: "meeting",
        occurredAt: NOW,
        summary: "Lecture planning meeting",
        source: "manual",
        confidence: "high",
        createdAt: NOW,
        updatedAt: NOW,
      }),
      asRecord<OwnerDataExportRelationshipContext["interactions"][number]>({
        id: "interaction-other-owner",
        personId: "person-other-owner",
        ownerUserId: OTHER_OWNER,
        interactionType: "call",
        occurredAt: NOW,
        summary: "Other member interaction",
        source: "manual",
        confidence: "medium",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    followups,
    contextFacts: [
      asRecord<OwnerDataExportRelationshipContext["contextFacts"][number]>(contextFact),
      ...(["active", "archived"] as const).map((lifecycle) =>
        asRecord<OwnerDataExportRelationshipContext["contextFacts"][number]>({
          ...contextFact,
          id: `context-owned-${lifecycle}`,
          content: `Context fact ${lifecycle}`,
          lifecycle,
          sensitivity: "normal",
        }),
      ),
      asRecord<OwnerDataExportRelationshipContext["contextFacts"][number]>({
        ...contextFact,
        id: "context-household-native",
        subject: { kind: "household", householdId: HOUSEHOLD },
        content: "Household context must not be exported.",
        lifecycle: "active",
        sensitivity: "normal",
      }),
      asRecord<OwnerDataExportRelationshipContext["contextFacts"][number]>({
        ...contextFact,
        id: "context-other-owner",
        subject: { kind: "self", userId: OTHER_OWNER },
        content: "Other member context must not be exported.",
        lifecycle: "active",
        sensitivity: "normal",
      }),
    ],
  };
}

// fallow-ignore-next-line complexity
function actionsPlanningContext(): OwnerDataExportActionsPlanningContext {
  const action = {
    id: "action-owned",
    ownerUserId: OWNER,
    ownership: "member_owned",
    responsibilityHolderUserId: OWNER,
    occurrenceVersion: 2,
    title: "Replace the water filter",
    notes: "Use the model from the receipt.",
    links: [{ url: "https://example.com/filter", label: "Filter" }],
    status: "deferred",
    dueAt: date("2026-08-20T12:00:00.000Z"),
    deferUntil: date("2026-08-21T12:00:00.000Z"),
    recurrence: { interval: 6, unit: "month" },
    sourceRecordId: "source-owned-active",
    areaId: "area-owned",
    scope: "shared",
    householdId: HOUSEHOLD,
    assetHints: [{ label: "refrigerator water filter" }],
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const savedItem = {
    id: "saved-owned",
    ownerUserId: OWNER,
    ownership: "member_owned",
    kind: "link",
    title: "Filter guide",
    content: "A useful guide.",
    url: "https://example.com/guide",
    status: "archived",
    bringBackAt: date("2026-09-01T12:00:00.000Z"),
    bringBackTimeSemantics: "instant",
    sourceRecordId: "source-owned-active",
    scope: "private",
    householdId: null,
    resolvedAt: null,
    resolutionReason: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const giftPlan = {
    id: "gift-plan-owned",
    ownerUserId: OWNER,
    subjectName: "Ada",
    occasion: "Birthday",
    occasionOn: date("2026-12-10T12:00:00.000Z"),
    subjectPersonId: "person-owned",
    surpriseSubjectUserId: OTHER_OWNER,
    status: "celebrated",
    scope: "shared",
    householdId: HOUSEHOLD,
    lastActorUserId: OTHER_OWNER,
    revision: 4,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    generalActions: [
      asRecord<OwnerDataExportActionsPlanningContext["generalActions"][number]>(action),
      asRecord<OwnerDataExportActionsPlanningContext["generalActions"][number]>({
        ...action,
        id: "action-household-native",
        ownership: "household_native",
        title: "Household chore must not be exported",
        scope: "household",
      }),
      asRecord<OwnerDataExportActionsPlanningContext["generalActions"][number]>({
        ...action,
        id: "action-other-owner",
        ownerUserId: OTHER_OWNER,
        title: "Other member action must not be exported",
      }),
    ],
    generalActionAreas: [
      asRecord<OwnerDataExportActionsPlanningContext["generalActionAreas"][number]>({
        id: "area-owned",
        ownerUserId: OWNER,
        name: "Home",
        sortOrder: 0,
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    generalActionPeople: [
      asRecord<OwnerDataExportActionsPlanningContext["generalActionPeople"][number]>({
        id: "action-person-owned",
        generalActionId: action.id,
        personId: "person-owned",
        createdAt: NOW,
      }),
    ],
    generalActionAssets: [
      asRecord<OwnerDataExportActionsPlanningContext["generalActionAssets"][number]>({
        id: "action-asset-owned",
        createdByUserId: OWNER,
        generalActionId: action.id,
        assetId: "asset-owned",
        hintLabel: "refrigerator water filter",
        assetMemoryId: "asset-memory-owned",
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportActionsPlanningContext["generalActionAssets"][number]>({
        id: "action-asset-household",
        createdByUserId: OWNER,
        generalActionId: action.id,
        assetId: "asset-household-native",
        hintLabel: "Household furnace",
        assetMemoryId: null,
        createdAt: NOW,
      }),
    ],
    generalActionEvents: [
      asRecord<OwnerDataExportActionsPlanningContext["generalActionEvents"][number]>({
        id: "action-event",
        generalActionId: action.id,
        ownerUserId: OWNER,
        kind: "deferred",
        actorUserId: OWNER,
        detailJson: {
          previousStatus: "open",
          status: "deferred",
          deferUntil: "2026-08-21T12:00:00.000Z",
          secretSession: "operational-secret",
        },
        createdAt: NOW,
      }),
    ],
    savedItems: [
      asRecord<OwnerDataExportActionsPlanningContext["savedItems"][number]>(savedItem),
      asRecord<OwnerDataExportActionsPlanningContext["savedItems"][number]>({
        ...savedItem,
        id: "saved-other-owner",
        ownerUserId: OTHER_OWNER,
        title: "Other member saved item must not be exported",
      }),
      asRecord<OwnerDataExportActionsPlanningContext["savedItems"][number]>({
        ...savedItem,
        id: "saved-household-native",
        ownerUserId: null,
        ownership: "household_native",
        title: "Household saved item must not be exported",
        scope: "household",
      }),
    ],
    savedItemEvents: [
      asRecord<OwnerDataExportActionsPlanningContext["savedItemEvents"][number]>({
        id: "saved-event",
        savedItemId: savedItem.id,
        ownerUserId: OWNER,
        kind: "promoted",
        actorUserId: OWNER,
        detailJson: { destinationKind: "general_action", destinationRecordId: action.id },
        createdAt: NOW,
      }),
    ],
    savedItemOutcomes: [
      asRecord<OwnerDataExportActionsPlanningContext["savedItemOutcomes"][number]>({
        id: "saved-outcome",
        savedItemId: savedItem.id,
        destinationKind: "general_action",
        destinationRecordId: action.id,
        idempotencyKey: "promotion-1",
        createdAt: NOW,
      }),
    ],
    messageDrafts: [
      asRecord<OwnerDataExportActionsPlanningContext["messageDrafts"][number]>({
        id: "draft-internal",
        personId: "person-owned",
        ownerUserId: OWNER,
        channel: "email",
        purpose: "check_in",
        body: "How is the lecture going?",
        status: "approved",
        sourceRefs: [
          {
            kind: "source_record",
            id: "source-owned-active",
            label: "Lecture note",
            trust: "logged_context",
          },
        ],
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    giftPlans: [asRecord<OwnerDataExportActionsPlanningContext["giftPlans"][number]>(giftPlan)],
    giftIdeas: [
      asRecord<OwnerDataExportActionsPlanningContext["giftIdeas"][number]>({
        id: "gift-idea-contribution",
        giftPlanId: giftPlan.id,
        contributorUserId: OTHER_OWNER,
        title: "A fountain pen",
        note: "She mentioned this.",
        url: "https://example.com/pen",
        claimedByUserId: OTHER_OWNER,
        claimedAt: NOW,
        lastActorUserId: OTHER_OWNER,
        revision: 2,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    giftPlanEvents: [
      asRecord<OwnerDataExportActionsPlanningContext["giftPlanEvents"][number]>({
        id: "gift-event",
        giftPlanId: giftPlan.id,
        kind: "idea_claimed",
        actorUserId: OTHER_OWNER,
        detailJson: { giftIdeaId: "gift-idea-contribution" },
        createdAt: NOW,
      }),
    ],
    recordShares: [
      asRecord<OwnerDataExportActionsPlanningContext["recordShares"][number]>({
        id: "share-from-owner",
        householdId: HOUSEHOLD,
        recordKind: "general_action",
        recordId: action.id,
        sharedWithUserId: OTHER_OWNER,
        sharedByUserId: OWNER,
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportActionsPlanningContext["recordShares"][number]>({
        id: "share-to-owner",
        householdId: HOUSEHOLD,
        recordKind: "general_action",
        recordId: action.id,
        sharedWithUserId: OWNER,
        sharedByUserId: OTHER_OWNER,
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportActionsPlanningContext["recordShares"][number]>({
        id: "share-only-record",
        householdId: HOUSEHOLD,
        recordKind: "saved_item",
        recordId: "saved-other-owner",
        sharedWithUserId: OWNER,
        sharedByUserId: OTHER_OWNER,
        createdAt: NOW,
      }),
    ],
    sourceRecordIds: [
      "source-owned-active",
      "source-owned-pending_resolution",
      "source-owned-dismissed",
      "source-owned-archived",
    ],
    personIds: ["person-owned"],
    memoryIds: [
      "memory-owned-approved",
      "memory-owned-suggested",
      "memory-owned-dismissed",
      "memory-owned-archived",
    ],
    followupIds: [
      "followup-owned-open",
      "followup-owned-suggested",
      "followup-owned-snoozed",
      "followup-owned-completed",
      "followup-owned-dismissed",
      "followup-owned-archived",
    ],
    sensitivityByRecordId: { "source-owned-active": "restricted" },
  };
}

// fallow-ignore-next-line complexity
function assetsContext(): OwnerDataExportAssetsContext {
  const asset = {
    id: "asset-owned",
    ownerUserId: OWNER,
    name: "Kitchen Refrigerator",
    kind: "appliance",
    status: "archived",
    scope: "shared",
    ownership: "member_owned",
    householdId: HOUSEHOLD,
    archivedAt: NOW,
    revision: 4,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const assetMemory = {
    id: "asset-memory-owned",
    assetId: asset.id,
    ownerUserId: OWNER,
    status: "active",
    label: "Filter size",
    value: { type: "text", text: "4 inch" },
    notes: "Replace twice a year.",
    scope: "private",
    ownership: "member_owned",
    householdId: null,
    revision: 3,
    sourceRecordId: "source-owned-active",
    reviewGroupId: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const evidence = {
    id: "evidence-owned",
    assetId: asset.id,
    ownerUserId: OWNER,
    kind: "manual",
    label: "Filter manual",
    fileName: "../manuals/filter/manual.pdf",
    mimeType: "application/pdf",
    sizeBytes: 8,
    url: null,
    capturedText: "Keep the filter dry.",
    money: null,
    purchasedOn: "2026-08-01",
    renewsOn: null,
    scope: "private",
    ownership: "member_owned",
    householdId: null,
    sourceRecordId: "source-owned-active",
    reviewGroupId: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    assets: [
      asRecord<OwnerDataExportAssetsContext["assets"][number]>(asset),
      asRecord<OwnerDataExportAssetsContext["assets"][number]>({
        ...asset,
        id: "asset-owned-suggested",
        name: "Replacement Filter",
        kind: "item",
        status: "suggested",
        scope: "private",
        householdId: null,
        archivedAt: null,
      }),
      asRecord<OwnerDataExportAssetsContext["assets"][number]>({
        ...asset,
        id: "asset-household-native",
        name: "Household Furnace",
        status: "active",
        scope: "household",
        ownership: "household_native",
      }),
      asRecord<OwnerDataExportAssetsContext["assets"][number]>({
        ...asset,
        id: "asset-other-owner",
        name: "Other Member Vehicle",
        ownerUserId: OTHER_OWNER,
        status: "active",
      }),
    ],
    assetMemories: [
      asRecord<OwnerDataExportAssetsContext["assetMemories"][number]>(assetMemory),
      asRecord<OwnerDataExportAssetsContext["assetMemories"][number]>({
        ...assetMemory,
        id: "asset-memory-household-native",
        assetId: "asset-household-native",
        ownership: "household_native",
        householdId: HOUSEHOLD,
        scope: "household",
        sourceRecordId: null,
        value: { type: "text", text: "Household-only value" },
      }),
      asRecord<OwnerDataExportAssetsContext["assetMemories"][number]>({
        ...assetMemory,
        id: "asset-memory-other-owner",
        ownerUserId: OTHER_OWNER,
        value: { type: "text", text: "Other member value" },
      }),
    ],
    assetEvidence: [
      asRecord<OwnerDataExportAssetsContext["assetEvidence"][number]>(evidence),
      asRecord<OwnerDataExportAssetsContext["assetEvidence"][number]>({
        ...evidence,
        id: "evidence-owned-note",
        kind: "note",
        label: "Install note",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        sourceRecordId: null,
      }),
      asRecord<OwnerDataExportAssetsContext["assetEvidence"][number]>({
        ...evidence,
        id: "evidence-household-native",
        assetId: "asset-household-native",
        ownership: "household_native",
        householdId: HOUSEHOLD,
        scope: "household",
        label: "Household-only evidence",
        fileName: "furnace.png",
        mimeType: "image/png",
        sizeBytes: 3,
        sourceRecordId: null,
      }),
      asRecord<OwnerDataExportAssetsContext["assetEvidence"][number]>({
        ...evidence,
        id: "evidence-other-owner",
        ownerUserId: OTHER_OWNER,
        label: "Other member evidence",
        scope: "shared",
        householdId: HOUSEHOLD,
        sizeBytes: 3,
        sourceRecordId: null,
      }),
    ],
    assetEvidenceFiles: [
      {
        evidenceId: evidence.id,
        ownerUserId: OWNER,
        bytes: new Uint8Array([0, 1, 2, 3, 255, 254, 0, 9]),
      },
      {
        evidenceId: "evidence-household-native",
        ownerUserId: OWNER,
        bytes: new Uint8Array([8, 8, 8]),
      },
      {
        evidenceId: "evidence-other-owner",
        ownerUserId: OTHER_OWNER,
        bytes: new Uint8Array([7, 7, 7]),
      },
    ],
    assetLinks: [
      asRecord<OwnerDataExportAssetsContext["assetLinks"][number]>({
        id: "asset-link-owned",
        ownerUserId: OWNER,
        fromAssetId: "asset-owned-suggested",
        toAssetId: asset.id,
        relation: "fits",
        status: "active",
        sourceRecordId: "source-owned-active",
        createdAt: NOW,
        updatedAt: NOW,
      }),
      asRecord<OwnerDataExportAssetsContext["assetLinks"][number]>({
        id: "asset-link-foreign",
        ownerUserId: OWNER,
        fromAssetId: asset.id,
        toAssetId: "asset-other-owner",
        relation: "replaces",
        status: "dismissed",
        sourceRecordId: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    assetPersonLinks: [
      asRecord<OwnerDataExportAssetsContext["assetPersonLinks"][number]>({
        id: "asset-person-owned",
        ownerUserId: OWNER,
        assetId: asset.id,
        personId: "person-owned",
        relation: "services",
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportAssetsContext["assetPersonLinks"][number]>({
        id: "asset-person-foreign",
        ownerUserId: OWNER,
        assetId: asset.id,
        personId: "person-other-owner",
        relation: "knows_about",
        createdAt: NOW,
      }),
    ],
    sensitivityByRecordId: { "source-owned-active": "restricted" },
  };
}

describe("owner data export qualification", () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it("qualifies the owner graph through processing, ZIP inspection, isolation, and expiry", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore(jobs);
    const relationship = relationshipContext();
    const actions = actionsPlanningContext();
    const assets = assetsContext();
    const generate = async (input: Parameters<typeof generateOwnerDataExportArchive>[0]) =>
      generateOwnerDataExportArchive({
        ...input,
        account: ACCOUNT,
        relationshipContext: relationship,
        actionsPlanningContext: actions,
        assetsContext: assets,
      });

    const requested = await enqueueAndTriggerOwnerDataExportJob(
      {
        ownerUserId: OWNER,
        idempotencyKey: "qualification-request",
        runtimeMode: "inline",
        now: NOW,
      },
      { jobs, artifacts, generate },
    );

    expect(requested.created).toBe(true);
    expect(requested.processResult?.outcome).toBe("completed");
    expect(requested.processResult?.job).toMatchObject({
      ownerUserId: OWNER,
      status: "completed",
      artifactExpiresAt: EXPIRES,
    });
    const artifact = await artifacts.get({ jobId: requested.job.id, ownerUserId: OWNER, now: NOW });
    if (!artifact) throw new Error("Expected the completed owner artifact.");
    const entries = readStoredZipEntries(artifact.bytes);
    const manifest = JSON.parse(entries.get("manifest.json") ?? "null") as {
      includedFamilies: string[];
      exclusions: string[];
      notes: string[];
      resources: Array<{
        path: string;
        recordCount?: number;
        fileCount?: number;
        fileByteCount?: number;
        sensitivity?: string;
      }>;
    };

    expect(manifest.includedFamilies).toEqual(
      expect.arrayContaining([
        "account profile",
        "People",
        "Contact Methods",
        "Memories",
        "Source Records",
        "Interactions",
        "Follow-Ups",
        "Self Context",
        "Assets",
        "Asset Memories",
        "Asset Evidence",
        "Asset Links",
        "Asset Person Links",
        "General Actions",
        "General Action Areas",
        "Saved Items",
        "Message Drafts",
        "Gift Plans",
        "Share Metadata",
      ]),
    );
    expect(manifest.exclusions.join(" ")).toEqual(
      expect.stringContaining("credentials, sessions, OAuth tokens, and provider connection state"),
    );
    expect(manifest.exclusions.join(" ")).toEqual(
      expect.stringContaining("Household-native records and generated Orientation Context"),
    );
    expect(manifest.notes).toEqual(
      expect.arrayContaining([
        "Import is not included in this release.",
        "A future Household Workspace export requires separate authorization.",
      ]),
    );

    const people = jsonResource(entries, "resources/people/people-v1.json");
    expect(people).toEqual([expect.objectContaining({ id: "person-owned", ownerUserId: OWNER })]);
    expect(jsonResource(entries, "resources/people/contact-methods-v1.json")).toEqual([
      expect.objectContaining({ id: "contact-owned", personId: "person-owned" }),
    ]);
    expect(
      new Set(
        jsonResource(entries, "resources/relationship/source-records-v1.json").map(
          (row) => (row as { status: string }).status,
        ),
      ),
    ).toEqual(new Set(["pending_resolution", "active", "dismissed", "archived"]));
    expect(
      new Set(
        jsonResource(entries, "resources/relationship/memories-v1.json").map(
          (row) => (row as { status: string }).status,
        ),
      ),
    ).toEqual(new Set(["suggested", "approved", "dismissed", "archived"]));
    expect(
      new Set(
        jsonResource(entries, "resources/relationship/follow-ups-v1.json").map(
          (row) => (row as { status: string }).status,
        ),
      ),
    ).toEqual(new Set(["suggested", "open", "snoozed", "completed", "dismissed", "archived"]));
    expect(
      new Set(
        jsonResource(entries, "resources/context/context-facts-v1.json").map(
          (row) => (row as { lifecycle: string }).lifecycle,
        ),
      ),
    ).toEqual(new Set(["suggested", "active", "archived"]));
    expect(jsonResource(entries, "resources/context/context-facts-v1.json")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "context-household-native" })]),
    );

    expect(jsonResource(entries, "resources/actions/general-actions-v1.json")).toEqual([
      expect.objectContaining({ id: "action-owned", ownership: "member_owned" }),
    ]);
    expect(jsonResource(entries, "resources/actions/general-action-assets-v1.json")).toEqual([
      expect.objectContaining({ assetId: "asset-owned", assetMemoryId: "asset-memory-owned" }),
    ]);
    expect(jsonResource(entries, "resources/saved-items/saved-items-v1.json")).toEqual([
      expect.objectContaining({ id: "saved-owned", status: "archived" }),
    ]);
    expect(jsonResource(entries, "resources/drafts/message-drafts-v1.json")).toEqual([
      expect.objectContaining({ id: "draft-internal", status: "approved" }),
    ]);
    expect(jsonResource(entries, "resources/gift-plans/gift-plans-v1.json")).toEqual([
      expect.objectContaining({ id: "gift-plan-owned", status: "celebrated" }),
    ]);
    expect(jsonResource(entries, "resources/sharing/record-shares-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "share-from-owner", sharedByUserId: OWNER }),
        expect.objectContaining({ id: "share-to-owner", sharedWithUserId: OWNER }),
      ]),
    );
    expect(jsonResource(entries, "resources/sharing/record-shares-v1.json")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "share-only-record" })]),
    );

    expect(jsonResource(entries, "resources/assets/assets-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "asset-owned", status: "archived" }),
        expect.objectContaining({ id: "asset-owned-suggested", status: "suggested" }),
      ]),
    );
    expect(jsonResource(entries, "resources/assets/assets-v1.json")).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "asset-household-native" }),
        expect.objectContaining({ id: "asset-other-owner" }),
      ]),
    );
    expect(jsonResource(entries, "resources/assets/asset-evidence-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence-owned",
          filePath: "resources/assets/evidence/evidence-owned/manual.pdf",
          sensitivity: "restricted",
        }),
        expect.objectContaining({ id: "evidence-owned-note", filePath: null }),
      ]),
    );
    expect(jsonResource(entries, "resources/assets/asset-evidence-v1.json")).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "evidence-household-native" }),
        expect.objectContaining({ id: "evidence-other-owner" }),
      ]),
    );
    const storedEvidence = readStoredZipEntryBytes(
      artifact.bytes,
      "resources/assets/evidence/evidence-owned/manual.pdf",
    );
    expect([...storedEvidence]).toStrictEqual([0, 1, 2, 3, 255, 254, 0, 9]);
    expect(jsonResource(entries, "resources/assets/asset-links-v1.json")).toEqual([
      expect.objectContaining({
        id: "asset-link-owned",
        fromAssetId: "asset-owned-suggested",
        toAssetId: "asset-owned",
      }),
    ]);
    expect(jsonResource(entries, "resources/assets/asset-person-links-v1.json")).toEqual([
      expect.objectContaining({ id: "asset-person-owned", personId: "person-owned" }),
    ]);

    const inventory = entries.get("inventory.txt") ?? "";
    expect(inventory).toContain("Reconnect provider integrations after");
    expect(inventory).toContain(
      "resources/assets/asset-evidence-v1.json, 2 records, 1 file, 8 evidence bytes",
    );
    const archiveText = new TextDecoder().decode(artifact.bytes);
    expect(archiveText).not.toContain("Other member");
    expect(archiveText).not.toContain("Household chore must not be exported");
    expect(archiveText).not.toContain("Household Furnace");
    expect(archiveText).not.toContain("Household saved item must not be exported");
    expect(archiveText).not.toContain("Household context must not be exported");
    expect(archiveText).not.toContain("Household-only evidence");
    expect(archiveText).not.toContain("Household-only value");
    expect(archiveText).not.toContain("provider payload must not be exported");
    expect(archiveText).not.toContain("operational-secret");
    expect(archiveText).not.toContain("operational-id");
    expect(archiveText).not.toContain("share-only-record");
    expect(archiveText).not.toContain("Import archive");
    expect(
      [...entries.keys()].some((path) =>
        /(?:notification|delivery|queue|audit|credential|session|oauth|cache|snapshot|embedding)/iu.test(
          path,
        ),
      ),
    ).toBe(false);

    const evidenceResource = manifest.resources.find(
      (resource) => resource.path === "resources/assets/asset-evidence-v1.json",
    );
    expect(evidenceResource).toMatchObject({
      fileCount: 1,
      fileByteCount: 8,
      sensitivity: "restricted",
    });
    expect(
      await artifacts.get({ jobId: requested.job.id, ownerUserId: OTHER_OWNER, now: NOW }),
    ).toBeNull();
    expect(
      await artifacts.get({
        jobId: requested.job.id,
        ownerUserId: OWNER,
        now: new Date(EXPIRES.getTime() - 1),
      }),
    ).not.toBeNull();
    expect(
      await artifacts.get({ jobId: requested.job.id, ownerUserId: OWNER, now: EXPIRES }),
    ).toBeNull();
    await expect(
      expireOwnerDataExportArtifacts({ jobs, artifacts, now: EXPIRES, limit: 10 }),
    ).resolves.toEqual({ scanned: 1, expired: 1, orphanedArtifacts: 0 });
    expect(await jobs.get({ jobId: requested.job.id })).toMatchObject({
      status: "expired",
      artifactExpiresAt: null,
    });
  });
});
