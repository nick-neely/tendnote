import type { BackgroundJobQueueSendInput } from "@tendnote/db/queries/background-job-deliveries";
import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import type {
  EnqueueAndTriggerOwnerDataExportJobInput,
  EnqueueAndTriggerOwnerDataExportJobResult,
  OwnerDataExportActionsPlanningContext,
  OwnerDataExportAssetsContext,
  OwnerDataExportRelationshipContext,
} from "@tendnote/db/queries/owner-data-export";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admittedOwnerOrNullSpy,
  requireAdmittedOwnerForActionSpy,
} from "@/test/action-adapter-mocks";

type OwnerDataExportModule = typeof import("@tendnote/db/queries/owner-data-export");
type OwnerDataExportJobStore = ReturnType<
  OwnerDataExportModule["createInMemoryOwnerDataExportJobStore"]
>;
type OwnerDataExportArtifactStore = ReturnType<
  OwnerDataExportModule["createInMemoryOwnerDataExportArtifactStore"]
>;
type BackgroundJobDeliveryStore = ReturnType<typeof createInMemoryBackgroundJobDeliveryStore>;
type OwnerDataExportEnqueueResult = EnqueueAndTriggerOwnerDataExportJobResult;
type OwnerDataExportEnqueueInput = EnqueueAndTriggerOwnerDataExportJobInput;
type OwnerDataExportProcessInput = Parameters<
  OwnerDataExportModule["processOwnerDataExportJob"]
>[0];
type OwnerDataExportProcessResult = Awaited<
  ReturnType<OwnerDataExportModule["processOwnerDataExportJob"]>
>;

const OWNER = "owner-1";
const OTHER_OWNER = "owner-2";
const HOUSEHOLD = "household-1";
const SOURCE = "source-owner-lecture";
const PERSON = "person-owner";
const ACTION = "action-owner-filter";
const ASSET = "asset-owner-fridge";
const ASSET_MEMORY = "asset-memory-owner-filter";
const NOW = new Date("2026-08-19T12:00:00.000Z");
const RETRY_AT = new Date("2026-08-19T12:05:00.000Z");
const EXPIRES = new Date("2026-08-20T12:05:00.000Z");

function asRecord<T>(value: object) {
  return value as T;
}

function readStoredZipEntries(bytes: Uint8Array) {
  const entries = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, decoder.decode(bytes.slice(contentStart, contentStart + size)));
    offset = contentStart + size;
  }
  return entries;
}

function readStoredZipEntryBytes(bytes: Uint8Array, wantedPath: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (name === wantedPath) return bytes.slice(contentStart, contentStart + size);
    offset = contentStart + size;
  }
  throw new Error(`Missing ZIP entry ${wantedPath}`);
}

function requireState<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label} is not initialized.`);
  return value;
}

const state = vi.hoisted(() => ({
  actual: null as OwnerDataExportModule | null,
  jobs: null as OwnerDataExportJobStore | null,
  artifacts: null as OwnerDataExportArtifactStore | null,
  deliveries: null as BackgroundJobDeliveryStore | null,
  messages: [] as BackgroundJobQueueSendInput[],
  send: null as ((input: BackgroundJobQueueSendInput) => Promise<{ messageId: string }>) | null,
  generate: null as OwnerDataExportModule["generateOwnerDataExportArchive"] | null,
  enqueue: null as
    | ((input: OwnerDataExportEnqueueInput) => Promise<OwnerDataExportEnqueueResult>)
    | null,
  process: null as
    | ((input: OwnerDataExportProcessInput) => Promise<OwnerDataExportProcessResult>)
    | null,
}));

/**
 * These are the actual provider boundaries that would turn this Account journey
 * into an external side effect. The factories throw if production code imports
 * one, so adding notification/Gmail draft work to enqueue, consume, or download
 * fails before the journey can report success. The flags make the negative
 * contract explicit in the assertion below rather than relying on ZIP text.
 */
const externalAdapterBoundary = vi.hoisted(() => ({
  gmailDraftWebAdapterImported: false,
  gmailDraftDbAdapterImported: false,
  invitationDeliveryImported: false,
  transactionalEmailImported: false,
  resendImported: false,
  webPushImported: false,
}));

vi.mock("@/lib/integrations/gmail-drafts", () => {
  externalAdapterBoundary.gmailDraftWebAdapterImported = true;
  throw new Error("Owner data export must not import the Gmail draft adapter.");
});
vi.mock("@tendnote/db/queries/gmail-drafts", () => {
  externalAdapterBoundary.gmailDraftDbAdapterImported = true;
  throw new Error("Owner data export must not import the Gmail draft DB adapter.");
});
vi.mock("@/lib/household/invitation-delivery", () => {
  externalAdapterBoundary.invitationDeliveryImported = true;
  throw new Error("Owner data export must not import notification delivery.");
});
vi.mock("@/lib/email/transactional", () => {
  externalAdapterBoundary.transactionalEmailImported = true;
  throw new Error("Owner data export must not import transactional email.");
});
vi.mock("@/lib/email/resend", () => {
  externalAdapterBoundary.resendImported = true;
  throw new Error("Owner data export must not import Resend.");
});
vi.mock("@/lib/background-jobs/web-push", () => {
  externalAdapterBoundary.webPushImported = true;
  throw new Error("Owner data export must not import Web Push.");
});

vi.mock("@tendnote/db/queries/owner-data-export", async () => {
  const actual = await vi.importActual<OwnerDataExportModule>(
    "@tendnote/db/queries/owner-data-export",
  );
  state.actual = actual;
  return {
    ...actual,
    getLatestOwnerDataExportJob: async (ownerUserId: string) =>
      state.jobs?.getLatestForOwner({ ownerUserId }) ?? null,
    createDrizzleOwnerDataExportJobStore: () => state.jobs,
    createDrizzleOwnerDataExportArtifactStore: () => state.artifacts,
    enqueueAndTriggerOwnerDataExportJob: (input: OwnerDataExportEnqueueInput) => {
      if (!state.enqueue) throw new Error("Export enqueue seam is not initialized.");
      return state.enqueue(input);
    },
    claimOwnerDataExportJob: (input: { jobId: string; now?: Date }) =>
      state.jobs?.claim(input) ?? null,
    claimNextOwnerDataExportJob: (input: { now?: Date }) => state.jobs?.claimNext(input) ?? null,
    getOwnerDataExportJob: (jobId: string) => state.jobs?.get({ jobId }) ?? null,
    processOwnerDataExportJob: (input: OwnerDataExportProcessInput) => {
      if (!state.process) throw new Error("Export process seam is not initialized.");
      return state.process(input);
    },
  };
});

vi.mock("@/lib/background-jobs/owner-data-export-queue", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/background-jobs/owner-data-export-queue")>();
  return {
    ...actual,
    enqueueAndPublishOwnerDataExportJob: (
      input: Parameters<typeof actual.enqueueAndPublishOwnerDataExportJob>[0],
    ) => {
      if (!state.deliveries || !state.send || !state.enqueue) {
        throw new Error("Export queue seam is not initialized.");
      }
      return actual.enqueueAndPublishOwnerDataExportJob({
        ...input,
        runtimeMode: "enqueue_only",
        deliveryStore: state.deliveries,
        queue: { send: state.send },
        enqueueOwnerDataExport: state.enqueue,
      });
    },
  };
});

import { consumeOwnerDataExportQueueMessage } from "@/lib/background-jobs/owner-data-export-queue";
import { requestOwnerDataExportAction } from "./actions/owner-data-export";
import { GET } from "./api/account/data-export/[jobId]/route";

function account() {
  return {
    id: OWNER,
    name: "Owner Example",
    email: "owner@example.com",
    accessStatus: "granted" as const,
    accessSource: "self_hosted_bootstrap",
    grantedAt: NOW,
  };
}

function relationshipContext() {
  const person = {
    id: PERSON,
    ownerUserId: OWNER,
    displayName: "Owner Person",
    firstName: "Owner",
    lastName: "Person",
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 1,
    profileBlurb: "Lecture collaborator",
    source: "manual",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const source = {
    id: SOURCE,
    ownerUserId: OWNER,
    householdId: null,
    sourceType: "manual",
    content: "Owner is preparing a lecture.",
    rawContent: "provider payload must not be exported",
    retentionPolicy: "retain",
    status: "active",
    confidence: "high",
    sensitivity: "restricted",
    scope: "private",
    importance: 4,
    metadataJson: { captureSurface: "account", providerToken: "operational-secret" },
    createdAt: NOW,
    updatedAt: NOW,
  };
  const memory = {
    id: "memory-owner-approved",
    personId: PERSON,
    ownerUserId: OWNER,
    householdId: null,
    sourceRecordId: SOURCE,
    memoryType: "context",
    content: "Owner is preparing a lecture.",
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
  const followup = {
    id: "followup-owner-open",
    personId: PERSON,
    ownerUserId: OWNER,
    reason: "Ask about the lecture",
    dueAt: EXPIRES,
    status: "open",
    cadence: null,
    sourceRecordId: SOURCE,
    lastPromptedAt: null,
    householdId: null,
    scope: "private",
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const graph = {
    people: [
      asRecord<OwnerDataExportRelationshipContext["people"][number]>(person),
      asRecord<OwnerDataExportRelationshipContext["people"][number]>({
        ...person,
        id: "person-other-owner",
        ownerUserId: OTHER_OWNER,
        displayName: "Other Member",
      }),
    ],
    contactMethods: [
      asRecord<OwnerDataExportRelationshipContext["contactMethods"][number]>({
        id: "contact-owner",
        personId: PERSON,
        type: "email",
        value: "owner-person@example.com",
        displayValue: "owner-person@example.com",
        normalizedValue: "owner-person@example.com",
        isPrimary: true,
        source: "manual",
        createdAt: NOW,
        updatedAt: NOW,
      }),
      asRecord<OwnerDataExportRelationshipContext["contactMethods"][number]>({
        id: "contact-other-owner",
        personId: "person-other-owner",
        type: "email",
        value: "other@example.com",
        displayValue: "other@example.com",
        normalizedValue: "other@example.com",
        isPrimary: true,
        source: "manual",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    memories: [
      asRecord<OwnerDataExportRelationshipContext["memories"][number]>(memory),
      asRecord<OwnerDataExportRelationshipContext["memories"][number]>({
        ...memory,
        id: "memory-owner-foreign-person",
        personId: "person-other-owner",
      }),
      asRecord<OwnerDataExportRelationshipContext["memories"][number]>({
        ...memory,
        id: "memory-owner-foreign-source",
        sourceRecordId: "source-other-owner",
      }),
    ],
    sourceRecords: [
      asRecord<OwnerDataExportRelationshipContext["sourceRecords"][number]>(source),
      asRecord<OwnerDataExportRelationshipContext["sourceRecords"][number]>({
        ...source,
        id: "source-owner-archived",
        content: "Archived owner source",
        status: "archived",
      }),
      asRecord<OwnerDataExportRelationshipContext["sourceRecords"][number]>({
        ...source,
        id: "source-other-owner",
        ownerUserId: OTHER_OWNER,
        householdId: HOUSEHOLD,
        content: "Other member source must not be exported.",
        sensitivity: "normal",
        scope: "shared",
      }),
    ],
    sourceRecordPeople: [
      asRecord<OwnerDataExportRelationshipContext["sourceRecordPeople"][number]>({
        id: "source-person-owner",
        sourceRecordId: SOURCE,
        personId: PERSON,
        role: "primary",
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportRelationshipContext["sourceRecordPeople"][number]>({
        id: "source-person-other-owner",
        sourceRecordId: "source-other-owner",
        personId: "person-other-owner",
        role: "mentioned",
        createdAt: NOW,
      }),
    ],
    unresolvedMentions: [
      asRecord<OwnerDataExportRelationshipContext["unresolvedMentions"][number]>({
        id: "mention-owner-unresolved",
        sourceRecordId: SOURCE,
        mentionText: "Owner",
        candidatePersonIds: [PERSON, "person-other-owner"],
        status: "unresolved",
        resolvedPersonId: null,
        createdAt: NOW,
        resolvedAt: null,
      }),
      asRecord<OwnerDataExportRelationshipContext["unresolvedMentions"][number]>({
        id: "mention-other-owner",
        sourceRecordId: "source-other-owner",
        mentionText: "Other",
        candidatePersonIds: ["person-other-owner"],
        status: "dismissed",
        resolvedPersonId: "person-other-owner",
        createdAt: NOW,
        resolvedAt: NOW,
      }),
    ],
    interactions: [
      asRecord<OwnerDataExportRelationshipContext["interactions"][number]>({
        id: "interaction-owner",
        personId: PERSON,
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
        id: "interaction-owner-foreign-person",
        personId: "person-other-owner",
        ownerUserId: OWNER,
        interactionType: "call",
        occurredAt: NOW,
        summary: "Foreign person interaction must not export",
        source: "manual",
        confidence: "medium",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    followups: [
      asRecord<OwnerDataExportRelationshipContext["followups"][number]>(followup),
      asRecord<OwnerDataExportRelationshipContext["followups"][number]>({
        ...followup,
        id: "followup-owner-foreign-source",
        sourceRecordId: "source-other-owner",
      }),
      asRecord<OwnerDataExportRelationshipContext["followups"][number]>({
        ...followup,
        id: "followup-owner-foreign-person",
        personId: "person-other-owner",
      }),
    ],
    contextFacts: [
      asRecord<OwnerDataExportRelationshipContext["contextFacts"][number]>({
        id: "context-owner",
        subject: { kind: "self", userId: OWNER },
        category: "work",
        content: "Owner works on privacy-preserving systems.",
        lifecycle: "suggested",
        sensitivity: "sensitive",
        provenance: { channel: "account", origin: "direct", sourceRecordId: SOURCE },
        suggestionEvidence: "A reviewable suggestion",
        creatorUserId: OWNER,
        lastActorUserId: OWNER,
        reviewedAt: null,
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
      asRecord<OwnerDataExportRelationshipContext["contextFacts"][number]>({
        id: "context-household-native",
        subject: { kind: "household", householdId: HOUSEHOLD },
        category: "home",
        content: "Household-native context must not export.",
        lifecycle: "active",
        sensitivity: "normal",
        provenance: { channel: "account", origin: "direct", sourceRecordId: null },
        suggestionEvidence: null,
        creatorUserId: OWNER,
        lastActorUserId: OWNER,
        reviewedAt: null,
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
      asRecord<OwnerDataExportRelationshipContext["contextFacts"][number]>({
        id: "context-other-owner",
        subject: { kind: "self", userId: OTHER_OWNER },
        category: "work",
        content: "Other member context must not export.",
        lifecycle: "active",
        sensitivity: "normal",
        provenance: { channel: "account", origin: "direct", sourceRecordId: null },
        suggestionEvidence: null,
        creatorUserId: OTHER_OWNER,
        lastActorUserId: OTHER_OWNER,
        reviewedAt: null,
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
  };
  return Object.assign(graph, {
    providerConnections: [{ id: "neutral-provider-connection", ownerUserId: OWNER }],
    sessions: [{ id: "neutral-session-row", ownerUserId: OWNER }],
    cacheEntries: [{ id: "neutral-cache-row", ownerUserId: OWNER }],
    snapshots: [{ id: "neutral-snapshot-row", ownerUserId: OWNER }],
    embeddings: [{ id: "neutral-embedding-row", ownerUserId: OWNER }],
    queueRows: [{ id: "neutral-queue-row", ownerUserId: OWNER }],
    deliveryRows: [{ id: "neutral-delivery-row", ownerUserId: OWNER }],
    auditRows: [{ id: "neutral-audit-row", ownerUserId: OWNER }],
  }) as OwnerDataExportRelationshipContext;
}

function actionsPlanningContext(): OwnerDataExportActionsPlanningContext {
  const action = {
    id: ACTION,
    ownerUserId: OWNER,
    ownership: "member_owned",
    responsibilityHolderUserId: OWNER,
    occurrenceVersion: 2,
    title: "Replace the water filter",
    notes: "Use the model from the receipt.",
    links: [{ url: "https://example.com/filter", label: "Filter" }],
    status: "deferred",
    dueAt: EXPIRES,
    deferUntil: new Date("2026-08-21T12:00:00.000Z"),
    recurrence: { interval: 6, unit: "month" },
    sourceRecordId: SOURCE,
    areaId: "area-owner-home",
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
    id: "saved-owner-guide",
    ownerUserId: OWNER,
    ownership: "member_owned",
    kind: "link",
    title: "Filter guide",
    content: "A useful guide.",
    url: "https://example.com/guide",
    status: "active",
    bringBackAt: null,
    bringBackTimeSemantics: null,
    sourceRecordId: SOURCE,
    scope: "private",
    householdId: null,
    resolvedAt: null,
    resolutionReason: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const messageDraft = {
    id: "draft-owner-approved",
    personId: PERSON,
    ownerUserId: OWNER,
    channel: "email",
    purpose: "check_in",
    body: "How is the lecture going?",
    status: "approved",
    sourceRefs: [
      { kind: "source_record", id: SOURCE, label: "Lecture note", trust: "logged_context" },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const giftPlan = {
    id: "gift-plan-owner",
    ownerUserId: OWNER,
    subjectName: "Owner Person",
    occasion: "Birthday",
    occasionOn: new Date("2026-12-10T12:00:00.000Z"),
    subjectPersonId: PERSON,
    surpriseSubjectUserId: OTHER_OWNER,
    status: "active",
    scope: "shared",
    householdId: HOUSEHOLD,
    lastActorUserId: OWNER,
    revision: 1,
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
        scope: "household",
        title: "Household chore must not export",
      }),
      asRecord<OwnerDataExportActionsPlanningContext["generalActions"][number]>({
        ...action,
        id: "action-other-owner",
        ownerUserId: OTHER_OWNER,
        title: "Other member action must not export",
      }),
    ],
    generalActionAreas: [
      asRecord<OwnerDataExportActionsPlanningContext["generalActionAreas"][number]>({
        id: "area-owner-home",
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
        id: "action-person-owner",
        generalActionId: ACTION,
        personId: PERSON,
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportActionsPlanningContext["generalActionPeople"][number]>({
        id: "action-person-foreign",
        generalActionId: ACTION,
        personId: "person-other-owner",
        createdAt: NOW,
      }),
    ],
    generalActionAssets: [
      asRecord<OwnerDataExportActionsPlanningContext["generalActionAssets"][number]>({
        id: "action-asset-owner",
        createdByUserId: OWNER,
        generalActionId: ACTION,
        assetId: ASSET,
        hintLabel: "refrigerator water filter",
        assetMemoryId: ASSET_MEMORY,
        createdAt: NOW,
      }),
    ],
    generalActionEvents: [
      asRecord<OwnerDataExportActionsPlanningContext["generalActionEvents"][number]>({
        id: "action-event-owner",
        generalActionId: ACTION,
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
      }),
    ],
    savedItemEvents: [
      asRecord<OwnerDataExportActionsPlanningContext["savedItemEvents"][number]>({
        id: "saved-event-owner",
        savedItemId: savedItem.id,
        ownerUserId: OWNER,
        kind: "promoted",
        actorUserId: OWNER,
        detailJson: { destinationKind: "general_action", destinationRecordId: ACTION },
        createdAt: NOW,
      }),
    ],
    savedItemOutcomes: [
      asRecord<OwnerDataExportActionsPlanningContext["savedItemOutcomes"][number]>({
        id: "saved-outcome-owner",
        savedItemId: savedItem.id,
        destinationKind: "general_action",
        destinationRecordId: ACTION,
        idempotencyKey: "promotion-owner",
        createdAt: NOW,
      }),
    ],
    messageDrafts: [
      asRecord<OwnerDataExportActionsPlanningContext["messageDrafts"][number]>(messageDraft),
      asRecord<OwnerDataExportActionsPlanningContext["messageDrafts"][number]>({
        ...messageDraft,
        id: "draft-other-owner",
        ownerUserId: OTHER_OWNER,
        personId: "person-other-owner",
        status: "draft",
      }),
    ],
    giftPlans: [
      asRecord<OwnerDataExportActionsPlanningContext["giftPlans"][number]>(giftPlan),
      asRecord<OwnerDataExportActionsPlanningContext["giftPlans"][number]>({
        ...giftPlan,
        id: "gift-plan-other-owner",
        ownerUserId: OTHER_OWNER,
        subjectPersonId: "person-other-owner",
      }),
    ],
    giftIdeas: [
      asRecord<OwnerDataExportActionsPlanningContext["giftIdeas"][number]>({
        id: "gift-idea-owner",
        giftPlanId: giftPlan.id,
        contributorUserId: OWNER,
        title: "A fountain pen",
        note: "They mentioned this.",
        url: "https://example.com/pen",
        claimedByUserId: null,
        claimedAt: null,
        lastActorUserId: OWNER,
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    giftPlanEvents: [
      asRecord<OwnerDataExportActionsPlanningContext["giftPlanEvents"][number]>({
        id: "gift-event-owner",
        giftPlanId: giftPlan.id,
        kind: "created",
        actorUserId: OWNER,
        detailJson: {},
        createdAt: NOW,
      }),
    ],
    recordShares: [
      asRecord<OwnerDataExportActionsPlanningContext["recordShares"][number]>({
        id: "share-from-owner",
        householdId: HOUSEHOLD,
        recordKind: "general_action",
        recordId: ACTION,
        sharedWithUserId: OTHER_OWNER,
        sharedByUserId: OWNER,
        createdAt: NOW,
      }),
      asRecord<OwnerDataExportActionsPlanningContext["recordShares"][number]>({
        id: "share-to-owner",
        householdId: HOUSEHOLD,
        recordKind: "general_action",
        recordId: ACTION,
        sharedWithUserId: OWNER,
        sharedByUserId: OTHER_OWNER,
        createdAt: NOW,
      }),
    ],
    sourceRecordIds: [SOURCE],
    personIds: [PERSON],
    memoryIds: [memoryId()],
    followupIds: ["followup-owner-open"],
    sensitivityByRecordId: { [SOURCE]: "restricted" },
  };
}

function memoryId() {
  return "memory-owner-approved";
}

function assetsContext(): OwnerDataExportAssetsContext {
  const asset = {
    id: ASSET,
    ownerUserId: OWNER,
    name: "Kitchen Refrigerator",
    kind: "appliance",
    status: "active",
    scope: "shared",
    ownership: "member_owned",
    householdId: HOUSEHOLD,
    archivedAt: null,
    revision: 1,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const relatedAsset = {
    ...asset,
    id: "asset-owner-filter",
    name: "Replacement Filter",
    kind: "item",
    status: "archived",
    scope: "private",
    householdId: null,
    archivedAt: NOW,
  };
  const assetMemory = {
    id: ASSET_MEMORY,
    assetId: ASSET,
    ownerUserId: OWNER,
    status: "active",
    label: "Filter size",
    value: { type: "text", text: "4 inch" },
    notes: "Replace twice a year.",
    scope: "private",
    ownership: "member_owned",
    householdId: null,
    revision: 1,
    sourceRecordId: SOURCE,
    reviewGroupId: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const evidence = {
    id: "evidence-owner-manual",
    assetId: ASSET,
    ownerUserId: OWNER,
    kind: "manual",
    label: "Filter manual",
    fileName: "manual.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
    url: null,
    capturedText: "Keep the filter dry.",
    money: null,
    purchasedOn: "2026-08-01",
    renewsOn: null,
    scope: "private",
    ownership: "member_owned",
    householdId: null,
    sourceRecordId: SOURCE,
    reviewGroupId: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    assets: [
      asRecord<OwnerDataExportAssetsContext["assets"][number]>(asset),
      asRecord<OwnerDataExportAssetsContext["assets"][number]>(relatedAsset),
      asRecord<OwnerDataExportAssetsContext["assets"][number]>({
        ...asset,
        id: "asset-household-native",
        ownership: "household_native",
        scope: "household",
        name: "Household Furnace",
      }),
    ],
    assetMemories: [
      asRecord<OwnerDataExportAssetsContext["assetMemories"][number]>(assetMemory),
      asRecord<OwnerDataExportAssetsContext["assetMemories"][number]>({
        ...assetMemory,
        id: "asset-memory-household-native",
        assetId: "asset-household-native",
        ownership: "household_native",
        scope: "household",
        householdId: HOUSEHOLD,
        sourceRecordId: null,
      }),
    ],
    assetEvidence: [
      asRecord<OwnerDataExportAssetsContext["assetEvidence"][number]>(evidence),
      asRecord<OwnerDataExportAssetsContext["assetEvidence"][number]>({
        ...evidence,
        id: "evidence-household-native",
        assetId: "asset-household-native",
        ownership: "household_native",
        scope: "household",
        householdId: HOUSEHOLD,
        fileName: "furnace.png",
        mimeType: "image/png",
        sizeBytes: 3,
        sourceRecordId: null,
      }),
    ],
    assetEvidenceFiles: [
      { evidenceId: evidence.id, ownerUserId: OWNER, bytes: new Uint8Array([1, 2, 3, 4]) },
      {
        evidenceId: "evidence-household-native",
        ownerUserId: OWNER,
        bytes: new Uint8Array([8, 8, 8]),
      },
    ],
    assetLinks: [
      asRecord<OwnerDataExportAssetsContext["assetLinks"][number]>({
        id: "asset-link-owner",
        ownerUserId: OWNER,
        fromAssetId: relatedAsset.id,
        toAssetId: ASSET,
        relation: "fits",
        status: "active",
        sourceRecordId: SOURCE,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ],
    assetPersonLinks: [
      asRecord<OwnerDataExportAssetsContext["assetPersonLinks"][number]>({
        id: "asset-person-owner",
        ownerUserId: OWNER,
        assetId: ASSET,
        personId: PERSON,
        relation: "services",
        createdAt: NOW,
      }),
    ],
    sourceRecordIds: [SOURCE],
    personIds: [PERSON],
    sensitivityByRecordId: { [SOURCE]: "restricted" },
  };
}

describe("owner data export Account journey", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    requireAdmittedOwnerForActionSpy.mockReset().mockResolvedValue(OWNER);
    admittedOwnerOrNullSpy.mockReset().mockResolvedValue(OWNER);
    const actual = requireState(state.actual, "Owner export module");
    const jobs = actual.createInMemoryOwnerDataExportJobStore();
    const artifacts = actual.createInMemoryOwnerDataExportArtifactStore(jobs);
    const deliveries = createInMemoryBackgroundJobDeliveryStore();
    state.jobs = jobs;
    state.artifacts = artifacts;
    state.deliveries = deliveries;
    state.messages = [];
    const send = vi.fn(async (input: BackgroundJobQueueSendInput) => {
      state.messages.push(input);
      return { messageId: "owner-export-message" };
    });
    state.send = send;
    const generate = vi.fn(
      async (input: Parameters<OwnerDataExportModule["generateOwnerDataExportArchive"]>[0]) =>
        actual.generateOwnerDataExportArchive({
          ...input,
          account: account(),
          relationshipContext: relationshipContext(),
          actionsPlanningContext: actionsPlanningContext(),
          assetsContext: assetsContext(),
        }),
    );
    generate.mockRejectedValueOnce(new Error("temporary export processing failure"));
    state.generate = generate as unknown as OwnerDataExportModule["generateOwnerDataExportArchive"];
    state.enqueue = (input: OwnerDataExportEnqueueInput) =>
      actual.enqueueAndTriggerOwnerDataExportJob(input, {
        jobs,
        artifacts,
        generate: generate as unknown as OwnerDataExportModule["generateOwnerDataExportArchive"],
      });
    state.process = (input: OwnerDataExportProcessInput) =>
      actual.processOwnerDataExportJob({
        ...input,
        jobs,
        artifacts,
        generate: generate as unknown as OwnerDataExportModule["generateOwnerDataExportArchive"],
      });
  });

  afterEach(() => vi.useRealTimers());

  it("composes Account request, queue delivery/recovery, and owner-authenticated download", async () => {
    const requested = await requestOwnerDataExportAction();
    expect(requested).toMatchObject({ ok: true, view: { ownerUserId: OWNER, status: "pending" } });
    expect(requireAdmittedOwnerForActionSpy).toHaveBeenCalledOnce();
    expect(state.send).toHaveBeenCalledOnce();
    const published = state.messages[0];
    if (!published) throw new Error("Expected a published owner export pointer.");
    expect(published.payload).toMatchObject({
      deliveryId: expect.any(String),
      jobKind: "owner_data_export",
      jobId: (requested as { ok: true; view: { id: string } }).view.id,
    });
    expect(published).not.toHaveProperty("archive");
    expect(published).not.toHaveProperty("draft");
    expect(published).not.toHaveProperty("notification");
    await expect(
      requireState(state.deliveries, "Delivery store").getBackgroundJobDeliveryForConsumer(
        published.payload.deliveryId,
      ),
    ).resolves.toMatchObject({
      ownerUserId: OWNER,
      jobKind: "owner_data_export",
      jobId: published.payload.jobId,
      status: "published",
    });

    await expect(
      consumeOwnerDataExportQueueMessage({
        payload: published.payload,
        deliveryStore: requireState(state.deliveries, "Delivery store"),
        now: NOW,
        metadata: { topicName: published.topic, messageId: "owner-export-message" },
      }),
    ).rejects.toThrow("temporary export processing failure");

    const failed = await requestOwnerDataExportAction();
    expect(failed).toMatchObject({
      ok: true,
      view: {
        id: (requested as { ok: true; view: { id: string } }).view.id,
        ownerUserId: OWNER,
        status: "failed",
        lastError: "temporary export processing failure",
        runAfter: RETRY_AT,
      },
    });
    expect(state.send).toHaveBeenCalledOnce();

    vi.setSystemTime(RETRY_AT);
    await expect(
      consumeOwnerDataExportQueueMessage({
        payload: published.payload,
        deliveryStore: requireState(state.deliveries, "Delivery store"),
        now: RETRY_AT,
        metadata: {
          topicName: published.topic,
          messageId: "owner-export-message",
          deliveryCount: 2,
        },
      }),
    ).resolves.toMatchObject({ status: "processed" });
    await expect(
      requireState(state.deliveries, "Delivery store").getBackgroundJobDeliveryForConsumer(
        published.payload.deliveryId,
      ),
    ).resolves.toMatchObject({ status: "published" });
    expect(state.generate).toHaveBeenCalledTimes(2);
    expect(externalAdapterBoundary).toEqual({
      gmailDraftWebAdapterImported: false,
      gmailDraftDbAdapterImported: false,
      invitationDeliveryImported: false,
      transactionalEmailImported: false,
      resendImported: false,
      webPushImported: false,
    });

    const jobId = (requested as { ok: true; view: { id: string } }).view.id;
    admittedOwnerOrNullSpy.mockResolvedValue(OWNER);
    const downloaded = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId }),
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("content-type")).toBe("application/zip");
    const downloadedBytes = new Uint8Array(await downloaded.arrayBuffer());
    expect(downloadedBytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    const downloadedEntries = readStoredZipEntries(downloadedBytes);
    const manifest = JSON.parse(downloadedEntries.get("manifest.json") ?? "null") as {
      expiresAt: string;
      includedFamilies: string[];
      exclusions: string[];
      notes: string[];
    };
    expect(manifest.expiresAt).toBe(EXPIRES.toISOString());
    expect(manifest.includedFamilies).toEqual(
      expect.arrayContaining([
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
    expect(manifest.exclusions).toEqual(
      expect.arrayContaining([
        "Household Workspace records, rosters, and records owned by another member",
        "records merely shared to the requester",
        "credentials, sessions, OAuth tokens, and provider connection state",
      ]),
    );
    expect(manifest.notes).toContain(
      "Reconnect provider integrations after moving this data to another deployment.",
    );
    const recordsAt = (path: string) =>
      JSON.parse(downloadedEntries.get(path) ?? "null").records as Array<Record<string, unknown>>;
    for (const [path, id] of [
      ["resources/people/people-v1.json", PERSON],
      ["resources/relationship/source-records-v1.json", SOURCE],
      ["resources/relationship/source-record-people-v1.json", "source-person-owner"],
      ["resources/relationship/unresolved-person-mentions-v1.json", "mention-owner-unresolved"],
      ["resources/relationship/interactions-v1.json", "interaction-owner"],
      ["resources/relationship/follow-ups-v1.json", "followup-owner-open"],
      ["resources/context/context-facts-v1.json", "context-owner"],
      ["resources/actions/general-actions-v1.json", ACTION],
      ["resources/actions/general-action-areas-v1.json", "area-owner-home"],
      ["resources/actions/general-action-people-v1.json", "action-person-owner"],
      ["resources/actions/general-action-assets-v1.json", "action-asset-owner"],
      ["resources/actions/general-action-events-v1.json", "action-event-owner"],
      ["resources/saved-items/saved-items-v1.json", "saved-owner-guide"],
      ["resources/saved-items/saved-item-events-v1.json", "saved-event-owner"],
      ["resources/saved-items/saved-item-outcomes-v1.json", "saved-outcome-owner"],
      ["resources/drafts/message-drafts-v1.json", "draft-owner-approved"],
      ["resources/gift-plans/gift-plans-v1.json", "gift-plan-owner"],
      ["resources/gift-plans/gift-plan-ideas-v1.json", "gift-idea-owner"],
      ["resources/gift-plans/gift-plan-events-v1.json", "gift-event-owner"],
      ["resources/sharing/record-shares-v1.json", "share-from-owner"],
      ["resources/assets/assets-v1.json", ASSET],
      ["resources/assets/asset-memories-v1.json", ASSET_MEMORY],
      ["resources/assets/asset-evidence-v1.json", "evidence-owner-manual"],
      ["resources/assets/asset-links-v1.json", "asset-link-owner"],
      ["resources/assets/asset-person-links-v1.json", "asset-person-owner"],
    ] as const) {
      expect(recordsAt(path), `${path} carries ${id}`).toEqual(
        expect.arrayContaining([expect.objectContaining({ id })]),
      );
    }
    for (const [path, forbiddenId] of [
      ["resources/people/people-v1.json", "person-other-owner"],
      ["resources/relationship/source-records-v1.json", "source-other-owner"],
      ["resources/relationship/interactions-v1.json", "interaction-owner-foreign-person"],
      ["resources/relationship/memories-v1.json", "memory-owner-foreign-person"],
      ["resources/relationship/memories-v1.json", "memory-owner-foreign-source"],
      ["resources/relationship/follow-ups-v1.json", "followup-owner-foreign-person"],
      ["resources/assets/asset-memories-v1.json", "asset-memory-household-native"],
      ["resources/assets/asset-evidence-v1.json", "evidence-household-native"],
    ] as const) {
      expect(
        recordsAt(path).some((row) => row.id === forbiddenId),
        `${path} excludes ${forbiddenId}`,
      ).toBe(false);
    }
    for (const forbiddenPath of [
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
    ]) {
      expect(downloadedEntries.has(forbiddenPath), `${forbiddenPath} remains absent`).toBe(false);
    }
    expect(recordsAt("resources/actions/general-actions-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ACTION,
          sourceRecordId: SOURCE,
          areaId: "area-owner-home",
          scope: "shared",
          householdId: HOUSEHOLD,
        }),
      ]),
    );
    expect(recordsAt("resources/assets/asset-links-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromAssetId: "asset-owner-filter", toAssetId: ASSET }),
      ]),
    );
    expect(recordsAt("resources/relationship/follow-ups-v1.json")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "followup-owner-foreign-source", sourceRecordId: null }),
      ]),
    );
    expect(
      downloadedEntries.has("resources/assets/evidence/evidence-owner-manual/manual.pdf"),
    ).toBe(true);
    expect(
      readStoredZipEntryBytes(
        downloadedBytes,
        "resources/assets/evidence/evidence-owner-manual/manual.pdf",
      ),
    ).toEqual(new Uint8Array([1, 2, 3, 4]));

    admittedOwnerOrNullSpy.mockResolvedValue(null);
    const refusedUnauthenticated = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId }),
    });
    admittedOwnerOrNullSpy.mockResolvedValue(OTHER_OWNER);
    const refusedOtherOwner = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId }),
    });
    expect(refusedUnauthenticated.status).toBe(404);
    expect(refusedOtherOwner.status).toBe(404);
    expect(await refusedOtherOwner.text()).toBe(await refusedUnauthenticated.text());

    admittedOwnerOrNullSpy.mockResolvedValue(OWNER);
    vi.setSystemTime(EXPIRES);
    const refusedAtExpiry = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId }),
    });
    expect(refusedAtExpiry.status).toBe(404);
  });
});
