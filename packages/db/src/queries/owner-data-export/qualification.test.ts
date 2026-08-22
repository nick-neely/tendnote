import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerDataExportActionsPlanningContext } from "./actions-planning";
import { readStoredZipEntries, readStoredZipEntryBytes } from "./archive-reader";
import type { OwnerDataExportAssetsContext } from "./assets";
import { generateOwnerDataExportArchive } from "./generator";
import {
  createInMemoryOwnerDataExportArtifactStore,
  createInMemoryOwnerDataExportJobStore,
} from "./in-memory-store";
import {
  enqueueAndTriggerOwnerDataExportJob,
  expireOwnerDataExportArtifacts,
  processOwnerDataExportJob,
} from "./processor";
import type { OwnerDataExportRelationshipContext } from "./relationship-context";

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

type ExportRow = Record<string, unknown>;

type OwnerBoundaryCase = {
  path: string;
  includedIds: readonly string[];
  excludedIds: readonly string[];
  ownerField?: string;
  isOwnedRow?: (row: ExportRow) => boolean;
};

function assertOwnerBoundaries(entries: Map<string, string>, cases: readonly OwnerBoundaryCase[]) {
  for (const boundary of cases) {
    const rows = jsonResource(entries, boundary.path) as ExportRow[];
    const ids = rows.map((row) => String(row.id));
    expect(new Set(ids), `${boundary.path} emitted ids`).toEqual(new Set(boundary.includedIds));
    for (const excludedId of boundary.excludedIds) {
      expect(ids, `${boundary.path} excludes ${excludedId}`).not.toContain(excludedId);
    }
    if (boundary.ownerField) {
      expect(
        rows.every((row) => row[boundary.ownerField as string] === OWNER),
        `${boundary.path} ${boundary.ownerField} ownership`,
      ).toBe(true);
    }
    if (boundary.isOwnedRow) {
      expect(rows.every(boundary.isOwnedRow), `${boundary.path} relationship ownership`).toBe(true);
    }
  }
}

function assertLifecycleCoverage(
  entries: Map<string, string>,
  cases: readonly { path: string; field: "status" | "lifecycle"; values: readonly string[] }[],
) {
  for (const lifecycle of cases) {
    const observed = (jsonResource(entries, lifecycle.path) as ExportRow[]).map((row) =>
      String(row[lifecycle.field]),
    );
    expect(new Set(observed), `${lifecycle.path} ${lifecycle.field} lifecycle`).toEqual(
      new Set(lifecycle.values),
    );
  }
}

function assertArchivePathsAbsent(entries: Map<string, string>, paths: readonly string[]) {
  for (const path of paths) {
    expect(entries.has(path), `${path} must remain absent`).toBe(false);
  }
}

function assertDeclaredArchiveResourcePaths(
  entries: Map<string, string>,
  manifest: { resources: Array<{ path: string }> },
) {
  const declaredResourcePaths = new Set(manifest.resources.map((resource) => resource.path));
  const evidencePaths = (
    jsonResource(entries, "resources/assets/asset-evidence-v1.json") as ExportRow[]
  )
    .map((row) => row.filePath)
    .filter((path): path is string => typeof path === "string");
  const allowedResourcePaths = new Set([...declaredResourcePaths, ...evidencePaths]);
  const actualResourcePaths = [...entries.keys()].filter((path) => path.startsWith("resources/"));
  expect(new Set(actualResourcePaths), "archive resource paths").toEqual(allowedResourcePaths);
}

const OPERATIONAL_CANDIDATE_IDS = [
  "neutral-provider-connection",
  "neutral-session-row",
  "neutral-cache-row",
  "neutral-snapshot-row",
  "neutral-embedding-row",
  "neutral-queue-row",
  "neutral-delivery-row",
  "neutral-audit-row",
] as const;

/**
 * Loader-shaped operational candidates make the negative boundary observable. The
 * export family loaders intentionally return only their typed durable graph, so these
 * rows can be present at the adapter seam without becoming portable resources.
 */
function withOperationalCandidates<T extends object>(context: T) {
  return Object.assign(context, {
    providerConnections: [
      {
        id: OPERATIONAL_CANDIDATE_IDS[0],
        ownerUserId: OWNER,
        path: "resources/provider-connections-v1.json",
      },
    ],
    sessions: [
      { id: OPERATIONAL_CANDIDATE_IDS[1], ownerUserId: OWNER, path: "resources/sessions-v1.json" },
    ],
    cacheEntries: [
      {
        id: OPERATIONAL_CANDIDATE_IDS[2],
        ownerUserId: OWNER,
        path: "resources/cache-entries-v1.json",
      },
    ],
    snapshots: [
      {
        id: OPERATIONAL_CANDIDATE_IDS[3],
        ownerUserId: OWNER,
        path: "resources/snapshots-v1.json",
      },
    ],
    embeddings: [
      {
        id: OPERATIONAL_CANDIDATE_IDS[4],
        ownerUserId: OWNER,
        path: "resources/embeddings-v1.json",
      },
    ],
    queueRows: [
      { id: OPERATIONAL_CANDIDATE_IDS[5], ownerUserId: OWNER, path: "resources/queues-v1.json" },
    ],
    deliveryRows: [
      {
        id: OPERATIONAL_CANDIDATE_IDS[6],
        ownerUserId: OWNER,
        path: "resources/deliveries-v1.json",
      },
    ],
    auditRows: [
      {
        id: OPERATIONAL_CANDIDATE_IDS[7],
        ownerUserId: OWNER,
        path: "resources/audit-rows-v1.json",
      },
    ],
  });
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
    {
      ...memory,
      id: "memory-owned-foreign-person",
      personId: "person-other-owner",
      content: "Owner memory linked to a foreign person must not be exported.",
    },
    {
      ...memory,
      id: "memory-owned-foreign-source",
      sourceRecordId: "source-other-owner",
      content: "Owner memory linked to a foreign source must not be exported.",
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
    {
      ...followup,
      id: "followup-owned-foreign-person",
      personId: "person-other-owner",
      reason: "Owner follow-up linked to a foreign person",
    },
    {
      ...followup,
      id: "followup-owned-foreign-source",
      sourceRecordId: "source-other-owner",
      reason: "Owner follow-up linked to a foreign source",
    },
  ].map((value) => asRecord<OwnerDataExportRelationshipContext["followups"][number]>(value));

  const mention = {
    id: "mention-owned-unresolved",
    sourceRecordId: memorySource,
    mentionText: "Ada",
    candidatePersonIds: [person.id, "person-other-owner"],
    status: "unresolved",
    resolvedPersonId: null,
    createdAt: NOW,
    resolvedAt: null,
  };
  const unresolvedMentions = [
    mention,
    ...(["resolved", "dismissed"] as const).map((status) => ({
      ...mention,
      id: `mention-owned-${status}`,
      status,
      resolvedPersonId: status === "resolved" ? person.id : null,
      resolvedAt: status === "resolved" ? NOW : null,
    })),
    {
      ...mention,
      id: "mention-other-owner",
      sourceRecordId: "source-other-owner",
      mentionText: "Grace",
      candidatePersonIds: ["person-other-owner"],
      status: "unresolved",
    },
  ].map((value) =>
    asRecord<OwnerDataExportRelationshipContext["unresolvedMentions"][number]>(value),
  );

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
    unresolvedMentions,
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
      asRecord<OwnerDataExportRelationshipContext["interactions"][number]>({
        id: "interaction-owned-foreign-person",
        personId: "person-other-owner",
        ownerUserId: OWNER,
        interactionType: "call",
        occurredAt: NOW,
        summary: "Owner interaction linked to a foreign person",
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
  const actionStatuses = [
    "open",
    "deferred",
    "completed",
    "dismissed",
    "archived",
    "paused",
    "suggested",
    "ignored",
  ] as const;
  const ownedActions = actionStatuses.map((status) => ({
    ...action,
    id: status === "deferred" ? action.id : `action-owned-${status}`,
    status,
    completedAt: status === "completed" ? NOW : null,
  }));
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
  const savedItemStatuses = ["active", "archived"] as const;
  const ownedSavedItems = savedItemStatuses.map((status) => ({
    ...savedItem,
    id: status === "archived" ? savedItem.id : `saved-owned-${status}`,
    status,
  }));
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
  const giftPlanStatuses = ["active", "celebrated", "archived"] as const;
  const ownedGiftPlans = giftPlanStatuses.map((status) => ({
    ...giftPlan,
    id: status === "celebrated" ? giftPlan.id : `gift-plan-owned-${status}`,
    status,
  }));
  const messageDraft = {
    id: "draft-internal-approved",
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
  };
  const messageDraftStatuses = ["draft", "approved", "dismissed", "sent_manually"] as const;
  const ownedMessageDrafts = messageDraftStatuses.map((status) => ({
    ...messageDraft,
    id: `draft-internal-${status}`,
    status,
  }));
  return {
    generalActions: [
      ...ownedActions.map((value) =>
        asRecord<OwnerDataExportActionsPlanningContext["generalActions"][number]>(value),
      ),
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
      asRecord<OwnerDataExportActionsPlanningContext["generalActionAreas"][number]>({
        id: "area-owned-archived",
        ownerUserId: OWNER,
        name: "Archived Area",
        sortOrder: 1,
        archivedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }),
      asRecord<OwnerDataExportActionsPlanningContext["generalActionAreas"][number]>({
        id: "area-other-owner",
        ownerUserId: OTHER_OWNER,
        name: "Other Member Area",
        sortOrder: 2,
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
      asRecord<OwnerDataExportActionsPlanningContext["generalActionPeople"][number]>({
        id: "action-person-other-action",
        generalActionId: "action-other-owner",
        personId: "person-other-owner",
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportActionsPlanningContext["generalActionPeople"][number]>({
        id: "action-person-foreign-person",
        generalActionId: action.id,
        personId: "person-other-owner",
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
      asRecord<OwnerDataExportActionsPlanningContext["generalActionAssets"][number]>({
        id: "action-asset-other-action",
        createdByUserId: OTHER_OWNER,
        generalActionId: "action-other-owner",
        assetId: "asset-other-owner",
        hintLabel: "Other member asset",
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
      asRecord<OwnerDataExportActionsPlanningContext["generalActionEvents"][number]>({
        id: "action-event-other-owner",
        generalActionId: "action-other-owner",
        ownerUserId: OTHER_OWNER,
        kind: "completed",
        actorUserId: OTHER_OWNER,
        detailJson: { status: "completed" },
        createdAt: NOW,
      }),
    ],
    savedItems: [
      ...ownedSavedItems.map((value) =>
        asRecord<OwnerDataExportActionsPlanningContext["savedItems"][number]>(value),
      ),
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
      asRecord<OwnerDataExportActionsPlanningContext["savedItemEvents"][number]>({
        id: "saved-event-other-owner",
        savedItemId: "saved-other-owner",
        ownerUserId: OTHER_OWNER,
        kind: "archived",
        actorUserId: OTHER_OWNER,
        detailJson: { status: "archived" },
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
      asRecord<OwnerDataExportActionsPlanningContext["savedItemOutcomes"][number]>({
        id: "saved-outcome-other-owner",
        savedItemId: "saved-other-owner",
        destinationKind: "general_action",
        destinationRecordId: "action-other-owner",
        idempotencyKey: "promotion-other-owner",
        createdAt: NOW,
      }),
    ],
    messageDrafts: [
      ...ownedMessageDrafts.map((value) =>
        asRecord<OwnerDataExportActionsPlanningContext["messageDrafts"][number]>(value),
      ),
      asRecord<OwnerDataExportActionsPlanningContext["messageDrafts"][number]>({
        ...messageDraft,
        id: "draft-other-owner",
        personId: "person-other-owner",
        ownerUserId: OTHER_OWNER,
        status: "draft",
        body: "Other member draft must not be exported.",
      }),
    ],
    giftPlans: [
      ...ownedGiftPlans.map((value) =>
        asRecord<OwnerDataExportActionsPlanningContext["giftPlans"][number]>(value),
      ),
      asRecord<OwnerDataExportActionsPlanningContext["giftPlans"][number]>({
        ...giftPlan,
        id: "gift-plan-other-owner",
        ownerUserId: OTHER_OWNER,
        subjectName: "Grace",
        subjectPersonId: "person-other-owner",
        status: "active",
      }),
    ],
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
      asRecord<OwnerDataExportActionsPlanningContext["giftIdeas"][number]>({
        id: "gift-idea-other-owner",
        giftPlanId: "gift-plan-other-owner",
        contributorUserId: OTHER_OWNER,
        title: "Other member gift idea",
        note: "Other member plan only",
        url: null,
        claimedByUserId: null,
        claimedAt: null,
        lastActorUserId: OTHER_OWNER,
        revision: 1,
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
      asRecord<OwnerDataExportActionsPlanningContext["giftPlanEvents"][number]>({
        id: "gift-event-other-owner",
        giftPlanId: "gift-plan-other-owner",
        kind: "created",
        actorUserId: OTHER_OWNER,
        detailJson: {},
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
        id: "share-foreign-action",
        householdId: HOUSEHOLD,
        recordKind: "general_action",
        recordId: "action-other-owner",
        sharedWithUserId: OWNER,
        sharedByUserId: OTHER_OWNER,
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
  const assetMemoryStatuses = ["suggested", "active", "dismissed"] as const;
  const ownedAssetMemories = assetMemoryStatuses.map((status) => ({
    ...assetMemory,
    id: status === "active" ? assetMemory.id : `asset-memory-owned-${status}`,
    status,
  }));
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
        id: "asset-owned-active",
        name: "Active Refrigerator",
        status: "active",
        archivedAt: null,
      }),
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
        id: "asset-owned-dismissed",
        name: "Dismissed Refrigerator",
        status: "dismissed",
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
      ...ownedAssetMemories.map((value) =>
        asRecord<OwnerDataExportAssetsContext["assetMemories"][number]>(value),
      ),
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
      asRecord<OwnerDataExportAssetsContext["assetMemories"][number]>({
        ...assetMemory,
        id: "asset-memory-foreign-parent",
        assetId: "asset-other-owner",
        value: { type: "text", text: "Owner memory with a foreign asset parent" },
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
      asRecord<OwnerDataExportAssetsContext["assetEvidence"][number]>({
        ...evidence,
        id: "evidence-foreign-parent",
        assetId: "asset-other-owner",
        label: "Owner evidence with a foreign asset parent",
        fileName: "foreign.pdf",
        mimeType: "application/pdf",
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
      {
        evidenceId: "evidence-foreign-parent",
        ownerUserId: OWNER,
        bytes: new Uint8Array([6, 6, 6]),
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
        id: "asset-link-owned-suggested",
        ownerUserId: OWNER,
        fromAssetId: "asset-owned-active",
        toAssetId: asset.id,
        relation: "uses",
        status: "suggested",
        sourceRecordId: "source-owned-active",
        createdAt: NOW,
        updatedAt: NOW,
      }),
      asRecord<OwnerDataExportAssetsContext["assetLinks"][number]>({
        id: "asset-link-owned-dismissed",
        ownerUserId: OWNER,
        fromAssetId: "asset-owned-dismissed",
        toAssetId: asset.id,
        relation: "covers",
        status: "dismissed",
        sourceRecordId: null,
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
        id: "asset-person-other-owner",
        ownerUserId: OTHER_OWNER,
        assetId: "asset-other-owner",
        personId: "person-other-owner",
        relation: "uses",
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
    const loadRelationshipContext = vi.fn(async () =>
      withOperationalCandidates(relationshipContext()),
    );
    const loadActionsPlanningContext = vi.fn(async () =>
      withOperationalCandidates(actionsPlanningContext()),
    );
    const loadAssetsContext = vi.fn(async () => withOperationalCandidates(assetsContext()));
    const generate = async (input: Parameters<typeof generateOwnerDataExportArchive>[0]) =>
      generateOwnerDataExportArchive({
        ...input,
        account: ACCOUNT,
        loadRelationshipContext,
        loadActionsPlanningContext,
        loadAssetsContext,
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
    expect(loadRelationshipContext).toHaveBeenCalledOnce();
    expect(loadActionsPlanningContext).toHaveBeenCalledOnce();
    expect(loadAssetsContext).toHaveBeenCalledOnce();
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
    expect(manifest.exclusions).toContain(
      "Household Workspace records, rosters, and records owned by another member",
    );
    expect(manifest.exclusions).toContain("records merely shared to the requester");
    expect(manifest.exclusions.join(" ")).toEqual(
      expect.stringContaining("Household-native records and generated Orientation Context"),
    );
    expect(manifest.exclusions).toContain(
      "raw provider payloads, calendar caches, generated snapshots, embeddings, queues, deliveries, and internal audit rows",
    );
    expect(manifest.notes).toEqual(
      expect.arrayContaining([
        "Import is not included in this release.",
        "A future Household Workspace export requires separate authorization.",
      ]),
    );
    expect(manifest.notes.join(" ")).toContain("Reconnect provider integrations after");
    expect(JSON.parse(entries.get("resources/account/profile-v1.json") ?? "null")).toMatchObject({
      id: OWNER,
      email: ACCOUNT.email,
      access: { status: "granted", source: ACCOUNT.accessSource },
    });
    expect(manifest.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "resources/relationship/source-records-v1.json",
          recordCount: 4,
          sensitivity: "restricted",
        }),
        expect.objectContaining({
          path: "resources/assets/asset-evidence-v1.json",
          recordCount: 2,
          fileCount: 1,
          fileByteCount: 8,
          sensitivity: "restricted",
        }),
      ]),
    );

    const people = jsonResource(entries, "resources/people/people-v1.json");
    expect(people).toEqual([expect.objectContaining({ id: "person-owned", ownerUserId: OWNER })]);
    expect(jsonResource(entries, "resources/people/contact-methods-v1.json")).toEqual([
      expect.objectContaining({ id: "contact-owned", personId: "person-owned" }),
    ]);
    expect(jsonResource(entries, "resources/relationship/source-record-people-v1.json")).toEqual([
      expect.objectContaining({
        id: "source-person-owned",
        sourceRecordId: "source-owned-active",
        personId: "person-owned",
        role: "primary",
      }),
    ]);
    expect(
      jsonResource(entries, "resources/relationship/unresolved-person-mentions-v1.json"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mention-owned-unresolved",
          sourceRecordId: "source-owned-active",
          candidatePersonIds: ["person-owned"],
          resolvedPersonId: null,
        }),
        expect.objectContaining({
          id: "mention-owned-resolved",
          status: "resolved",
          resolvedPersonId: "person-owned",
        }),
        expect.objectContaining({ id: "mention-owned-dismissed", status: "dismissed" }),
      ]),
    );
    expect(jsonResource(entries, "resources/relationship/interactions-v1.json")).toEqual([
      expect.objectContaining({
        id: "interaction-owned",
        ownerUserId: OWNER,
        personId: "person-owned",
        interactionType: "meeting",
      }),
    ]);
    expect(jsonResource(entries, "resources/relationship/source-records-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "source-owned-active",
          ownerUserId: OWNER,
          householdId: null,
          scope: "private",
          sensitivity: "restricted",
          metadataJson: { captureSurface: "account" },
        }),
      ]),
    );
    expect(jsonResource(entries, "resources/relationship/memories-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "memory-owned-approved",
          ownerUserId: OWNER,
          personId: "person-owned",
          sourceRecordId: "source-owned-active",
          householdId: null,
          scope: "private",
          sensitivity: "restricted",
        }),
      ]),
    );
    expect(jsonResource(entries, "resources/relationship/follow-ups-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "followup-owned-open",
          ownerUserId: OWNER,
          personId: "person-owned",
          sourceRecordId: "source-owned-active",
          householdId: null,
          scope: "private",
        }),
      ]),
    );
    expect(jsonResource(entries, "resources/context/context-facts-v1.json")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "context-household-native" })]),
    );
    expect(jsonResource(entries, "resources/context/context-facts-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "context-owned-suggested",
          subject: { kind: "self", userId: OWNER },
          sensitivity: "sensitive",
          provenance: expect.objectContaining({ sourceRecordId: "source-owned-active" }),
        }),
      ]),
    );

    expect(jsonResource(entries, "resources/actions/general-actions-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "action-owned",
          ownerUserId: OWNER,
          ownership: "member_owned",
          areaId: "area-owned",
          sourceRecordId: "source-owned-active",
          scope: "shared",
          householdId: HOUSEHOLD,
          responsibilityHolderUserId: OWNER,
        }),
      ]),
    );
    expect(jsonResource(entries, "resources/actions/general-action-areas-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "area-owned", ownerUserId: OWNER, name: "Home" }),
        expect.objectContaining({ id: "area-owned-archived", ownerUserId: OWNER }),
      ]),
    );
    expect(jsonResource(entries, "resources/actions/general-action-people-v1.json")).toEqual([
      expect.objectContaining({
        id: "action-person-owned",
        generalActionId: "action-owned",
        personId: "person-owned",
      }),
    ]);
    expect(jsonResource(entries, "resources/actions/general-action-assets-v1.json")).toEqual([
      expect.objectContaining({
        id: "action-asset-owned",
        generalActionId: "action-owned",
        assetId: "asset-owned",
        assetMemoryId: "asset-memory-owned",
        createdByUserId: OWNER,
      }),
    ]);
    expect(jsonResource(entries, "resources/actions/general-action-events-v1.json")).toEqual([
      expect.objectContaining({
        id: "action-event",
        generalActionId: "action-owned",
        ownerUserId: OWNER,
        actorUserId: OWNER,
        detailJson: expect.objectContaining({
          status: "deferred",
          deferUntil: "2026-08-21T12:00:00.000Z",
        }),
      }),
    ]);
    expect(jsonResource(entries, "resources/saved-items/saved-items-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "saved-owned",
          ownerUserId: OWNER,
          status: "archived",
          sourceRecordId: "source-owned-active",
          scope: "private",
          householdId: null,
        }),
        expect.objectContaining({ id: "saved-owned-active", status: "active" }),
      ]),
    );
    expect(jsonResource(entries, "resources/saved-items/saved-item-events-v1.json")).toEqual([
      expect.objectContaining({
        id: "saved-event",
        savedItemId: "saved-owned",
        ownerUserId: OWNER,
        actorUserId: OWNER,
      }),
    ]);
    expect(jsonResource(entries, "resources/saved-items/saved-item-outcomes-v1.json")).toEqual([
      expect.objectContaining({
        id: "saved-outcome",
        savedItemId: "saved-owned",
        destinationKind: "general_action",
        destinationRecordId: "action-owned",
      }),
    ]);
    expect(jsonResource(entries, "resources/drafts/message-drafts-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "draft-internal-approved", status: "approved" }),
      ]),
    );
    expect(jsonResource(entries, "resources/gift-plans/gift-plans-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "gift-plan-owned",
          ownerUserId: OWNER,
          status: "celebrated",
          subjectPersonId: "person-owned",
          scope: "shared",
          householdId: HOUSEHOLD,
        }),
      ]),
    );
    expect(jsonResource(entries, "resources/gift-plans/gift-plan-ideas-v1.json")).toEqual([
      expect.objectContaining({
        id: "gift-idea-contribution",
        giftPlanId: "gift-plan-owned",
        contributorUserId: OTHER_OWNER,
      }),
    ]);
    expect(jsonResource(entries, "resources/gift-plans/gift-plan-events-v1.json")).toEqual([
      expect.objectContaining({
        id: "gift-event",
        giftPlanId: "gift-plan-owned",
        actorUserId: OTHER_OWNER,
      }),
    ]);
    expect(jsonResource(entries, "resources/sharing/record-shares-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "share-from-owner",
          householdId: HOUSEHOLD,
          recordKind: "general_action",
          recordId: "action-owned",
          sharedByUserId: OWNER,
          sharedWithUserId: OTHER_OWNER,
        }),
        expect.objectContaining({
          id: "share-to-owner",
          householdId: HOUSEHOLD,
          recordKind: "general_action",
          recordId: "action-owned",
          sharedByUserId: OTHER_OWNER,
          sharedWithUserId: OWNER,
        }),
      ]),
    );
    expect(jsonResource(entries, "resources/sharing/record-shares-v1.json")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "share-only-record" })]),
    );

    expect(jsonResource(entries, "resources/assets/assets-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "asset-owned",
          ownerUserId: OWNER,
          status: "archived",
          scope: "shared",
          ownership: "member_owned",
          householdId: HOUSEHOLD,
          sensitivity: "normal",
        }),
        expect.objectContaining({ id: "asset-owned-suggested", status: "suggested" }),
      ]),
    );
    expect(jsonResource(entries, "resources/assets/asset-memories-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "asset-memory-owned",
          assetId: "asset-owned",
          ownerUserId: OWNER,
          sourceRecordId: "source-owned-active",
          scope: "private",
          ownership: "member_owned",
          householdId: null,
          sensitivity: "restricted",
        }),
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
          assetId: "asset-owned",
          ownerUserId: OWNER,
          filePath: "resources/assets/evidence/evidence-owned/manual.pdf",
          sourceRecordId: "source-owned-active",
          scope: "private",
          ownership: "member_owned",
          householdId: null,
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
    expect(jsonResource(entries, "resources/assets/asset-links-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "asset-link-owned",
          ownerUserId: OWNER,
          fromAssetId: "asset-owned-suggested",
          toAssetId: "asset-owned",
          relation: "fits",
          sourceRecordId: "source-owned-active",
          status: "active",
        }),
      ]),
    );
    expect(jsonResource(entries, "resources/assets/asset-person-links-v1.json")).toEqual([
      expect.objectContaining({
        id: "asset-person-owned",
        ownerUserId: OWNER,
        assetId: "asset-owned",
        personId: "person-owned",
        relation: "services",
      }),
    ]);

    assertLifecycleCoverage(entries, [
      {
        path: "resources/relationship/source-records-v1.json",
        field: "status",
        values: ["pending_resolution", "active", "dismissed", "archived"],
      },
      {
        path: "resources/relationship/memories-v1.json",
        field: "status",
        values: ["suggested", "approved", "dismissed", "archived"],
      },
      {
        path: "resources/relationship/unresolved-person-mentions-v1.json",
        field: "status",
        values: ["unresolved", "resolved", "dismissed"],
      },
      {
        path: "resources/relationship/follow-ups-v1.json",
        field: "status",
        values: ["suggested", "open", "snoozed", "completed", "dismissed", "archived"],
      },
      {
        path: "resources/context/context-facts-v1.json",
        field: "lifecycle",
        values: ["suggested", "active", "archived"],
      },
      {
        path: "resources/actions/general-actions-v1.json",
        field: "status",
        values: [
          "open",
          "deferred",
          "completed",
          "dismissed",
          "archived",
          "paused",
          "suggested",
          "ignored",
        ],
      },
      {
        path: "resources/saved-items/saved-items-v1.json",
        field: "status",
        values: ["active", "archived"],
      },
      {
        path: "resources/drafts/message-drafts-v1.json",
        field: "status",
        values: ["draft", "approved", "dismissed", "sent_manually"],
      },
      {
        path: "resources/gift-plans/gift-plans-v1.json",
        field: "status",
        values: ["active", "celebrated", "archived"],
      },
      {
        path: "resources/assets/assets-v1.json",
        field: "status",
        values: ["active", "archived", "suggested", "dismissed"],
      },
      {
        path: "resources/assets/asset-memories-v1.json",
        field: "status",
        values: ["suggested", "active", "dismissed"],
      },
      {
        path: "resources/assets/asset-links-v1.json",
        field: "status",
        values: ["suggested", "active", "dismissed"],
      },
    ]);
    expect(
      new Set(
        (
          jsonResource(entries, "resources/actions/general-action-areas-v1.json") as ExportRow[]
        ).map((row) => (row.archivedAt === null ? "active" : "archived")),
      ),
    ).toEqual(new Set(["active", "archived"]));

    assertOwnerBoundaries(entries, [
      {
        path: "resources/people/people-v1.json",
        includedIds: ["person-owned"],
        excludedIds: ["person-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/people/contact-methods-v1.json",
        includedIds: ["contact-owned"],
        excludedIds: ["contact-other-owner"],
        isOwnedRow: (row) => row.personId === "person-owned",
      },
      {
        path: "resources/relationship/source-records-v1.json",
        includedIds: [
          "source-owned-active",
          "source-owned-pending_resolution",
          "source-owned-dismissed",
          "source-owned-archived",
        ],
        excludedIds: ["source-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/relationship/source-record-people-v1.json",
        includedIds: ["source-person-owned"],
        excludedIds: ["source-person-other"],
        isOwnedRow: (row) =>
          row.sourceRecordId === "source-owned-active" && row.personId === "person-owned",
      },
      {
        path: "resources/relationship/unresolved-person-mentions-v1.json",
        includedIds: [
          "mention-owned-unresolved",
          "mention-owned-resolved",
          "mention-owned-dismissed",
        ],
        excludedIds: ["mention-other-owner"],
        isOwnedRow: (row) =>
          row.sourceRecordId === "source-owned-active" &&
          (row.candidatePersonIds as string[]).every((id) => id === "person-owned"),
      },
      {
        path: "resources/relationship/interactions-v1.json",
        includedIds: ["interaction-owned"],
        excludedIds: ["interaction-other-owner", "interaction-owned-foreign-person"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/relationship/memories-v1.json",
        includedIds: [
          "memory-owned-approved",
          "memory-owned-suggested",
          "memory-owned-dismissed",
          "memory-owned-archived",
        ],
        excludedIds: [
          "memory-other-owner",
          "memory-owned-foreign-person",
          "memory-owned-foreign-source",
        ],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/relationship/follow-ups-v1.json",
        includedIds: [
          "followup-owned-open",
          "followup-owned-suggested",
          "followup-owned-snoozed",
          "followup-owned-completed",
          "followup-owned-dismissed",
          "followup-owned-archived",
          "followup-owned-foreign-source",
        ],
        excludedIds: ["followup-other-owner", "followup-owned-foreign-person"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/context/context-facts-v1.json",
        includedIds: ["context-owned-suggested", "context-owned-active", "context-owned-archived"],
        excludedIds: ["context-household-native", "context-other-owner"],
        isOwnedRow: (row) =>
          (row.subject as { kind?: string; userId?: string }).kind === "self" &&
          (row.subject as { userId?: string }).userId === OWNER,
      },
      {
        path: "resources/actions/general-actions-v1.json",
        includedIds: [
          "action-owned",
          "action-owned-open",
          "action-owned-completed",
          "action-owned-dismissed",
          "action-owned-archived",
          "action-owned-paused",
          "action-owned-suggested",
          "action-owned-ignored",
        ],
        excludedIds: ["action-household-native", "action-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/actions/general-action-areas-v1.json",
        includedIds: ["area-owned", "area-owned-archived"],
        excludedIds: ["area-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/actions/general-action-people-v1.json",
        includedIds: ["action-person-owned"],
        excludedIds: ["action-person-other-action", "action-person-foreign-person"],
        isOwnedRow: (row) =>
          row.generalActionId === "action-owned" && row.personId === "person-owned",
      },
      {
        path: "resources/actions/general-action-assets-v1.json",
        includedIds: ["action-asset-owned"],
        excludedIds: ["action-asset-household", "action-asset-other-action"],
        isOwnedRow: (row) =>
          row.generalActionId === "action-owned" &&
          row.assetId === "asset-owned" &&
          row.assetMemoryId === "asset-memory-owned",
      },
      {
        path: "resources/actions/general-action-events-v1.json",
        includedIds: ["action-event"],
        excludedIds: ["action-event-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/saved-items/saved-items-v1.json",
        includedIds: ["saved-owned", "saved-owned-active"],
        excludedIds: ["saved-other-owner", "saved-household-native"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/saved-items/saved-item-events-v1.json",
        includedIds: ["saved-event"],
        excludedIds: ["saved-event-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/saved-items/saved-item-outcomes-v1.json",
        includedIds: ["saved-outcome"],
        excludedIds: ["saved-outcome-other-owner"],
        isOwnedRow: (row) =>
          row.savedItemId === "saved-owned" && row.destinationRecordId === "action-owned",
      },
      {
        path: "resources/drafts/message-drafts-v1.json",
        includedIds: [
          "draft-internal-draft",
          "draft-internal-approved",
          "draft-internal-dismissed",
          "draft-internal-sent_manually",
        ],
        excludedIds: ["draft-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/gift-plans/gift-plans-v1.json",
        includedIds: ["gift-plan-owned", "gift-plan-owned-active", "gift-plan-owned-archived"],
        excludedIds: ["gift-plan-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/gift-plans/gift-plan-ideas-v1.json",
        includedIds: ["gift-idea-contribution"],
        excludedIds: ["gift-idea-other-owner"],
        isOwnedRow: (row) => row.giftPlanId === "gift-plan-owned",
      },
      {
        path: "resources/gift-plans/gift-plan-events-v1.json",
        includedIds: ["gift-event"],
        excludedIds: ["gift-event-other-owner"],
        isOwnedRow: (row) => row.giftPlanId === "gift-plan-owned",
      },
      {
        path: "resources/sharing/record-shares-v1.json",
        includedIds: ["share-from-owner", "share-to-owner"],
        excludedIds: ["share-only-record", "share-foreign-action"],
        isOwnedRow: (row) => row.recordId === "action-owned",
      },
      {
        path: "resources/assets/assets-v1.json",
        includedIds: [
          "asset-owned",
          "asset-owned-active",
          "asset-owned-suggested",
          "asset-owned-dismissed",
        ],
        excludedIds: ["asset-household-native", "asset-other-owner"],
        ownerField: "ownerUserId",
      },
      {
        path: "resources/assets/asset-memories-v1.json",
        includedIds: [
          "asset-memory-owned",
          "asset-memory-owned-suggested",
          "asset-memory-owned-dismissed",
        ],
        excludedIds: ["asset-memory-household-native", "asset-memory-other-owner"],
        ownerField: "ownerUserId",
        isOwnedRow: (row) =>
          row.assetId !== "asset-household-native" && row.assetId !== "asset-other-owner",
      },
      {
        path: "resources/assets/asset-evidence-v1.json",
        includedIds: ["evidence-owned", "evidence-owned-note"],
        excludedIds: ["evidence-household-native", "evidence-other-owner"],
        ownerField: "ownerUserId",
        isOwnedRow: (row) =>
          row.assetId !== "asset-household-native" && row.assetId !== "asset-other-owner",
      },
      {
        path: "resources/assets/asset-links-v1.json",
        includedIds: [
          "asset-link-owned",
          "asset-link-owned-suggested",
          "asset-link-owned-dismissed",
        ],
        excludedIds: ["asset-link-foreign"],
        ownerField: "ownerUserId",
        isOwnedRow: (row) =>
          (row.fromAssetId === "asset-owned" ||
            String(row.fromAssetId).startsWith("asset-owned-")) &&
          row.toAssetId === "asset-owned",
      },
      {
        path: "resources/assets/asset-person-links-v1.json",
        includedIds: ["asset-person-owned"],
        excludedIds: ["asset-person-foreign", "asset-person-other-owner"],
        ownerField: "ownerUserId",
        isOwnedRow: (row) => row.assetId === "asset-owned" && row.personId === "person-owned",
      },
    ]);

    const exportedFollowup = (
      jsonResource(entries, "resources/relationship/follow-ups-v1.json") as ExportRow[]
    ).find((row) => row.id === "followup-owned-foreign-source");
    expect(
      exportedFollowup,
      "owner follow-up with foreign source remains representable",
    ).toBeDefined();
    expect(exportedFollowup).toMatchObject({
      id: "followup-owned-foreign-source",
      personId: "person-owned",
      sourceRecordId: null,
    });
    const exportedAssetIds = new Set(
      (jsonResource(entries, "resources/assets/assets-v1.json") as ExportRow[]).map(
        (row) => row.id,
      ),
    );
    for (const path of [
      "resources/assets/asset-memories-v1.json",
      "resources/assets/asset-evidence-v1.json",
    ]) {
      expect(
        (jsonResource(entries, path) as ExportRow[]).every((row) =>
          exportedAssetIds.has(row.assetId),
        ),
        `${path} has no dangling foreign asset references`,
      ).toBe(true);
    }

    const inventory = entries.get("inventory.txt") ?? "";
    expect(inventory).toContain("Reconnect provider integrations after");
    expect(inventory).toContain(
      "resources/assets/asset-evidence-v1.json, 2 records, 1 file, 8 evidence bytes",
    );
    const excludedOperationalPaths = [
      "resources/provider-connections-v1.json",
      "resources/sessions-v1.json",
      "resources/cache-entries-v1.json",
      "resources/snapshots-v1.json",
      "resources/embeddings-v1.json",
      "resources/queues-v1.json",
      "resources/deliveries-v1.json",
      "resources/audit-rows-v1.json",
      "resources/notifications-v1.json",
      "resources/external-drafts-v1.json",
    ];
    assertArchivePathsAbsent(entries, excludedOperationalPaths);
    assertArchivePathsAbsent(entries, [
      "resources/assets/evidence/evidence-household-native/furnace.png",
      "resources/assets/evidence/evidence-other-owner/manual.pdf",
      "resources/assets/evidence/evidence-foreign-parent/foreign.pdf",
    ]);
    assertDeclaredArchiveResourcePaths(entries, manifest);

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

  it("keeps failed processing truthful, schedules recovery, and completes queue-less backfill", async () => {
    const jobs = createInMemoryOwnerDataExportJobStore();
    const artifacts = createInMemoryOwnerDataExportArtifactStore(jobs);
    const retryAt = new Date(NOW.getTime() + 5 * 60 * 1000);
    const generate = vi.fn(async (input: Parameters<typeof generateOwnerDataExportArchive>[0]) =>
      generateOwnerDataExportArchive({
        ...input,
        account: ACCOUNT,
        relationshipContext: relationshipContext(),
      }),
    );
    generate.mockRejectedValueOnce(new Error("temporary archive outage"));

    const requested = await enqueueAndTriggerOwnerDataExportJob(
      {
        ownerUserId: OWNER,
        idempotencyKey: "qualification-retry",
        runtimeMode: "inline",
        now: NOW,
      },
      { jobs, artifacts, generate },
    );

    expect(requested.processResult).toMatchObject({
      outcome: "failed",
      error: "temporary archive outage",
      job: {
        ownerUserId: OWNER,
        status: "failed",
        lastError: "temporary archive outage",
        runAfter: retryAt,
        attempts: 1,
      },
    });
    expect(
      await artifacts.get({ jobId: requested.job.id, ownerUserId: OWNER, now: NOW }),
    ).toBeNull();
    await expect(jobs.claimNext({ now: NOW })).resolves.toBeNull();

    const recoveredClaim = await jobs.claimNext({ now: retryAt });
    expect(recoveredClaim).toMatchObject({
      id: requested.job.id,
      ownerUserId: OWNER,
      status: "running",
      attempts: 2,
    });
    if (!recoveredClaim?.claimToken) throw new Error("Expected the retry claim token.");

    const recovered = await processOwnerDataExportJob({
      jobId: recoveredClaim.id,
      claim: false,
      claimToken: recoveredClaim.claimToken,
      jobs,
      artifacts,
      generate,
      now: retryAt,
    });
    expect(recovered).toMatchObject({
      outcome: "completed",
      job: {
        ownerUserId: OWNER,
        status: "completed",
        attempts: 2,
        artifactExpiresAt: new Date(retryAt.getTime() + 24 * 60 * 60 * 1000),
      },
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(
      await artifacts.get({ jobId: requested.job.id, ownerUserId: OWNER, now: retryAt }),
    ).not.toBeNull();
  });
});
