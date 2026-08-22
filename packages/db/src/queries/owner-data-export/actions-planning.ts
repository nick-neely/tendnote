import type {
  GeneralAction,
  GeneralActionArea,
  GeneralActionAssetLink,
  GeneralActionEvent,
  GiftIdea,
  GiftPlan,
  GiftPlanEvent,
  MessageDraft,
  SavedItem,
  SavedItemEvent,
  SavedItemOutcome,
} from "@tendnote/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../client";
import {
  followups,
  generalActionAreas,
  generalActionAssets,
  generalActionEvents,
  generalActionPeople,
  generalActions,
  giftIdeas,
  giftPlanEvents,
  giftPlans,
  householdRecordShares,
  memories,
  messageDrafts,
  people,
  savedItemEvents,
  savedItemOutcomes,
  savedItems,
  sourceRecords,
} from "../../schema";
import type { HouseholdRecordShare } from "../households/types";
import { archiveEntry } from "./archive";
import { envelope, iso, jsonBytes, sensitivityRank, sortByCreatedAt, sortById } from "./shared";
import type { OwnerDataExportResource } from "./types";

/** The small relationship row between a member-owned Action and a Person. */
export type OwnerDataExportGeneralActionPerson = {
  id: string;
  generalActionId: string;
  personId: string;
  createdAt: Date;
};

export type OwnerDataExportGrounding = {
  sourceRecordIds?: readonly string[];
  personIds?: readonly string[];
  memoryIds?: readonly string[];
  followupIds?: readonly string[];
  /** Exact owner-owned Asset graph supplied by the Asset export extension. */
  assetIds?: readonly string[];
  assetMemoryIds?: readonly string[];
  sensitivityByRecordId?: Readonly<Record<string, OwnerDataExportSensitivity>>;
};

export type OwnerDataExportSensitivity = "normal" | "sensitive" | "restricted";

/**
 * All durable, owner-keyed records covered by the actions-planning slice. The
 * optional id lists are loader facts used to validate cross-family references;
 * they do not become resources of this module. In particular, the module never
 * accepts provider rows, embedding rows, jobs, deliveries, or audit tables.
 */
export type OwnerDataExportActionsPlanningContext = {
  generalActions: GeneralAction[];
  generalActionAreas: GeneralActionArea[];
  generalActionPeople: OwnerDataExportGeneralActionPerson[];
  generalActionAssets: GeneralActionAssetLink[];
  generalActionEvents: GeneralActionEvent[];
  savedItems: SavedItem[];
  savedItemEvents: SavedItemEvent[];
  savedItemOutcomes: SavedItemOutcome[];
  messageDrafts: MessageDraft[];
  giftPlans: GiftPlan[];
  giftIdeas: GiftIdea[];
  giftPlanEvents: GiftPlanEvent[];
  recordShares: HouseholdRecordShare[];
  sourceRecordIds?: string[];
  personIds?: string[];
  memoryIds?: string[];
  followupIds?: string[];
  sensitivityByRecordId?: Record<string, OwnerDataExportSensitivity>;
};

export type OwnerDataExportActionsPlanningContextLoader = (input: {
  ownerUserId: string;
}) => Promise<OwnerDataExportActionsPlanningContext>;

function maxSensitivity(values: readonly (OwnerDataExportSensitivity | undefined)[]) {
  const value = values.reduce<OwnerDataExportSensitivity>(
    (highest, candidate) =>
      candidate && sensitivityRank(candidate) > sensitivityRank(highest) ? candidate : highest,
    "normal",
  );
  return value;
}

function sensitivityOf(
  recordIds: readonly (string | null | undefined)[],
  directValues: readonly (OwnerDataExportSensitivity | undefined)[],
  sensitivityByRecordId: Readonly<Record<string, OwnerDataExportSensitivity>>,
) {
  return maxSensitivity([
    ...directValues,
    ...recordIds.map((id) => (id ? sensitivityByRecordId[id] : undefined)),
  ]);
}

function resource<T>(
  path: string,
  records: readonly T[],
  sensitivity: OwnerDataExportSensitivity = "normal",
) {
  const bytes = jsonBytes(envelope(records));
  return {
    entry: archiveEntry({ path, bytes }),
    resource: {
      path,
      schemaVersion: "1.0",
      contentType: "application/json" as const,
      recordCount: records.length,
      byteCount: bytes.byteLength,
      sensitivity,
    },
  };
}

const ACTION_EVENT_DETAIL_KEYS = new Set([
  "previousStatus",
  "status",
  "scope",
  "previousScope",
  "householdId",
  "ownership",
  "grounded",
  "filed",
  "peopleLinked",
  "assetHints",
  "recurring",
  "responsibilityHolderNamed",
  "previousHolderUserId",
  "holderUserId",
  "handedOff",
  "removedOwnReminder",
  "occurrenceVersion",
  "occurrenceAdvancedAt",
  "previousDueAt",
  "nextDueAt",
  "deferUntil",
  "rolledForward",
  "restoredDueAt",
  "rolledBack",
  "reviewEdit",
  "editedTitle",
  "editedNotes",
  "editedDueAt",
  "editedLinks",
  "editedAssetHints",
  "editedArea",
  "editedRecurrence",
  "editedVisibility",
  "editedPeople",
  "fromSuggestion",
  "sourceRecordId",
  "edited",
  "reviewUndo",
]);

const SAVED_ITEM_EVENT_DETAIL_KEYS = new Set([
  "previousStatus",
  "status",
  "editedTitle",
  "editedContent",
  "editedUrl",
  "editedBringBackAt",
  "kind",
  "scope",
  "grounded",
  "destinationKind",
  "destinationRecordId",
  "idempotencyKey",
  "resumed",
  "ownership",
  "version",
  "operation",
  "errorName",
]);

const GIFT_PLAN_EVENT_DETAIL_KEYS = new Set([
  "scope",
  "previousScope",
  "reason",
  "idempotencyKey",
  "giftIdeaId",
  "resumed",
  "previousStatus",
  "status",
  "surpriseSubjectUserId",
]);

function durableDetail(
  detail: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (!Object.hasOwn(detail, key)) continue;
    const value = detail[key];
    if (typeof value === "function" || typeof value === "symbol" || value === undefined) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function generalActionForExport(action: GeneralAction) {
  return {
    id: action.id,
    ownerUserId: action.ownerUserId,
    ownership: action.ownership,
    responsibilityHolderUserId: action.responsibilityHolderUserId,
    occurrenceVersion: action.occurrenceVersion,
    title: action.title,
    notes: action.notes,
    links: action.links,
    status: action.status,
    dueAt: iso(action.dueAt),
    deferUntil: iso(action.deferUntil),
    recurrence: action.recurrence,
    sourceRecordId: action.sourceRecordId,
    areaId: action.areaId,
    scope: action.scope,
    householdId: action.householdId,
    assetHints: action.assetHints,
    createdByUserId: action.createdByUserId ?? null,
    lastActorUserId: action.lastActorUserId ?? null,
    completedAt: iso(action.completedAt),
    createdAt: iso(action.createdAt),
    updatedAt: iso(action.updatedAt),
  };
}

function areaForExport(area: GeneralActionArea) {
  return {
    id: area.id,
    ownerUserId: area.ownerUserId,
    name: area.name,
    sortOrder: area.sortOrder,
    archivedAt: iso(area.archivedAt),
    createdAt: iso(area.createdAt),
    updatedAt: iso(area.updatedAt),
  };
}

function actionPersonForExport(link: OwnerDataExportGeneralActionPerson) {
  return {
    id: link.id,
    generalActionId: link.generalActionId,
    personId: link.personId,
    createdAt: iso(link.createdAt),
  };
}

function actionAssetForExport(link: GeneralActionAssetLink) {
  return {
    id: link.id,
    createdByUserId: link.createdByUserId,
    generalActionId: link.generalActionId,
    assetId: link.assetId,
    hintLabel: link.hintLabel,
    assetMemoryId: link.assetMemoryId,
    createdAt: iso(link.createdAt),
  };
}

function actionEventForExport(event: GeneralActionEvent) {
  return {
    id: event.id,
    generalActionId: event.generalActionId,
    ownerUserId: event.ownerUserId,
    kind: event.kind,
    actorUserId: event.actorUserId,
    detailJson: durableDetail(event.detailJson, ACTION_EVENT_DETAIL_KEYS),
    createdAt: iso(event.createdAt),
  };
}

function savedItemForExport(item: SavedItem) {
  return {
    id: item.id,
    ownerUserId: item.ownerUserId,
    ownership: item.ownership,
    kind: item.kind,
    title: item.title,
    content: item.content,
    url: item.url,
    status: item.status,
    bringBackAt: iso(item.bringBackAt),
    bringBackTimeSemantics: item.bringBackTimeSemantics,
    sourceRecordId: item.sourceRecordId,
    scope: item.scope,
    householdId: item.householdId,
    resolvedAt: iso(item.resolvedAt),
    resolutionReason: item.resolutionReason,
    createdByUserId: item.createdByUserId,
    lastActorUserId: item.lastActorUserId,
    version: item.version,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
  };
}

function savedItemEventForExport(event: SavedItemEvent) {
  return {
    id: event.id,
    savedItemId: event.savedItemId,
    ownerUserId: event.ownerUserId,
    kind: event.kind,
    actorUserId: event.actorUserId,
    detailJson: durableDetail(event.detailJson, SAVED_ITEM_EVENT_DETAIL_KEYS),
    createdAt: iso(event.createdAt),
  };
}

function savedItemOutcomeForExport(outcome: SavedItemOutcome) {
  return {
    id: outcome.id,
    savedItemId: outcome.savedItemId,
    destinationKind: outcome.destinationKind,
    destinationRecordId: outcome.destinationRecordId,
    idempotencyKey: outcome.idempotencyKey,
    createdAt: iso(outcome.createdAt),
  };
}

function draftForExport(draft: MessageDraft) {
  return {
    id: draft.id,
    personId: draft.personId,
    ownerUserId: draft.ownerUserId,
    channel: draft.channel,
    purpose: draft.purpose,
    body: draft.body,
    status: draft.status,
    sourceRefs: draft.sourceRefs.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
      label: ref.label,
      trust: ref.trust,
    })),
    createdAt: iso(draft.createdAt),
    updatedAt: iso(draft.updatedAt),
  };
}

function giftPlanForExport(plan: GiftPlan) {
  return {
    id: plan.id,
    ownerUserId: plan.ownerUserId,
    subjectName: plan.subjectName,
    occasion: plan.occasion,
    occasionOn: iso(plan.occasionOn),
    subjectPersonId: plan.subjectPersonId,
    surpriseSubjectUserId: plan.surpriseSubjectUserId,
    status: plan.status,
    scope: plan.scope,
    householdId: plan.householdId,
    lastActorUserId: plan.lastActorUserId,
    revision: plan.revision,
    createdAt: iso(plan.createdAt),
    updatedAt: iso(plan.updatedAt),
  };
}

function giftIdeaForExport(idea: GiftIdea) {
  return {
    id: idea.id,
    giftPlanId: idea.giftPlanId,
    contributorUserId: idea.contributorUserId,
    title: idea.title,
    note: idea.note,
    url: idea.url,
    claimedByUserId: idea.claimedByUserId,
    claimedAt: iso(idea.claimedAt),
    lastActorUserId: idea.lastActorUserId,
    revision: idea.revision,
    createdAt: iso(idea.createdAt),
    updatedAt: iso(idea.updatedAt),
  };
}

function giftPlanEventForExport(event: GiftPlanEvent) {
  return {
    id: event.id,
    giftPlanId: event.giftPlanId,
    kind: event.kind,
    actorUserId: event.actorUserId,
    detailJson: durableDetail(event.detailJson, GIFT_PLAN_EVENT_DETAIL_KEYS),
    createdAt: iso(event.createdAt),
  };
}

function shareForExport(share: HouseholdRecordShare) {
  return {
    id: share.id,
    householdId: share.householdId,
    recordKind: share.recordKind,
    recordId: share.recordId,
    sharedWithUserId: share.sharedWithUserId,
    sharedByUserId: share.sharedByUserId,
    createdAt: iso(share.createdAt),
  };
}

function setFrom(values: readonly string[] | undefined) {
  return new Set(values ?? []);
}

function prefer<T>(value: T | undefined, fallback: T | undefined) {
  return value ?? fallback;
}

function assertGroundedReference(
  family: string,
  recordId: string,
  sourceRecordId: string,
  sourceRecordIds: ReadonlySet<string>,
) {
  if (!sourceRecordIds.has(sourceRecordId)) {
    throw new Error(
      `Owner data export ${family} ${recordId} references source record ${sourceRecordId} outside the owner export.`,
    );
  }
}

function validateDraftReference(
  draftId: string,
  ref: MessageDraft["sourceRefs"][number],
  grounding: {
    sourceRecordIds: ReadonlySet<string>;
    memoryIds: ReadonlySet<string>;
    followupIds: ReadonlySet<string>;
  },
) {
  if (ref.kind === "source_record") {
    assertGroundedReference("message draft", draftId, ref.id, grounding.sourceRecordIds);
    return;
  }
  if (ref.kind === "approved_memory" || ref.kind === "suggested_memory") {
    if (!grounding.memoryIds.has(ref.id)) {
      throw new Error(
        `Owner data export message draft ${draftId} references memory ${ref.id} outside the owner export.`,
      );
    }
    return;
  }
  if (ref.kind === "followup") {
    if (!grounding.followupIds.has(ref.id)) {
      throw new Error(
        `Owner data export message draft ${draftId} references follow-up ${ref.id} outside the owner export.`,
      );
    }
    return;
  }
  const unsupportedKind = (ref as { kind?: unknown }).kind;
  throw new Error(
    `Owner data export message draft ${draftId} has unsupported source reference kind ${String(unsupportedKind)}.`,
  );
}

function validateDraftReferences(
  draft: MessageDraft,
  grounding: {
    sourceRecordIds: ReadonlySet<string>;
    memoryIds: ReadonlySet<string>;
    followupIds: ReadonlySet<string>;
  },
) {
  for (const ref of draft.sourceRefs) validateDraftReference(draft.id, ref, grounding);
}

function validateActionReferences(
  actions: readonly GeneralAction[],
  areas: ReadonlySet<string>,
  sourceRecordIds: ReadonlySet<string>,
) {
  for (const action of actions) {
    if (action.sourceRecordId) {
      assertGroundedReference("General Action", action.id, action.sourceRecordId, sourceRecordIds);
    }
    if (action.areaId && !areas.has(action.areaId)) {
      throw new Error(
        `Owner data export General Action ${action.id} references Area ${action.areaId} outside the owner export.`,
      );
    }
  }
}

function validateSavedItemReferences(
  items: readonly SavedItem[],
  sourceRecordIds: ReadonlySet<string>,
) {
  for (const item of items) {
    assertGroundedReference("Saved Item", item.id, item.sourceRecordId, sourceRecordIds);
  }
}

function directSensitivity(value: unknown): OwnerDataExportSensitivity | undefined {
  if (value === "restricted" || value === "sensitive" || value === "normal") return value;
  return undefined;
}

function buildGrounding(
  context: OwnerDataExportActionsPlanningContext,
  grounding: OwnerDataExportGrounding | undefined,
) {
  return {
    sourceRecordIds: setFrom(prefer(grounding?.sourceRecordIds, context.sourceRecordIds)),
    personIds: setFrom(prefer(grounding?.personIds, context.personIds)),
    memoryIds: setFrom(prefer(grounding?.memoryIds, context.memoryIds)),
    followupIds: setFrom(prefer(grounding?.followupIds, context.followupIds)),
    assetIds: grounding?.assetIds === undefined ? undefined : new Set(grounding.assetIds),
    assetMemoryIds:
      grounding?.assetMemoryIds === undefined ? undefined : new Set(grounding.assetMemoryIds),
    sensitivityByRecordId:
      prefer(grounding?.sensitivityByRecordId, context.sensitivityByRecordId) ?? {},
  };
}

/**
 * Defense-in-depth owner and ownership filter for the complete actions-planning
 * graph. The database loader applies the same predicates; keeping this pure
 * filter at the archive seam protects test/future adapters that hand it a wider
 * candidate set and makes Household-native rows impossible to export.
 */
export function filterOwnerDataExportActionsPlanningContext(
  ownerUserId: string,
  input: OwnerDataExportActionsPlanningContext,
  grounding?: OwnerDataExportGrounding,
): OwnerDataExportActionsPlanningContext {
  const facts = buildGrounding(input, grounding);
  const actions = sortById(
    input.generalActions.filter(
      (action) => action.ownerUserId === ownerUserId && action.ownership === "member_owned",
    ),
  );
  const actionIds = new Set(actions.map((action) => action.id));
  const areas = sortById(
    input.generalActionAreas.filter((area) => area.ownerUserId === ownerUserId),
  );
  const areaIds = new Set(areas.map((area) => area.id));
  const items = sortById(
    input.savedItems.filter(
      (item) => item.ownerUserId === ownerUserId && item.ownership === "member_owned",
    ),
  );
  const itemIds = new Set(items.map((item) => item.id));
  const plans = sortById(input.giftPlans.filter((plan) => plan.ownerUserId === ownerUserId));
  const planIds = new Set(plans.map((plan) => plan.id));
  const personIds = facts.personIds;

  validateActionReferences(actions, areaIds, facts.sourceRecordIds);
  validateSavedItemReferences(items, facts.sourceRecordIds);

  const drafts = sortById(input.messageDrafts.filter((draft) => draft.ownerUserId === ownerUserId));
  for (const draft of drafts) {
    if (!personIds.has(draft.personId)) {
      throw new Error(
        `Owner data export message draft ${draft.id} references Person ${draft.personId} outside the owner export.`,
      );
    }
  }
  for (const draft of drafts) validateDraftReferences(draft, facts);

  const actionPeople = sortById(
    input.generalActionPeople.filter(
      (link) => actionIds.has(link.generalActionId) && personIds.has(link.personId),
    ),
  );
  const actionAssets = sortById(
    input.generalActionAssets.filter(
      (link) =>
        actionIds.has(link.generalActionId) &&
        (facts.assetIds === undefined || facts.assetIds.has(link.assetId)) &&
        (!link.assetMemoryId ||
          facts.assetMemoryIds === undefined ||
          facts.assetMemoryIds.has(link.assetMemoryId)),
    ),
  );
  const actionEvents = sortByCreatedAt(
    input.generalActionEvents.filter(
      (event) => event.ownerUserId === ownerUserId && actionIds.has(event.generalActionId),
    ),
  );
  const itemEvents = sortByCreatedAt(
    input.savedItemEvents.filter(
      (event) => event.ownerUserId === ownerUserId && itemIds.has(event.savedItemId),
    ),
  );
  const itemOutcomes = sortByCreatedAt(
    input.savedItemOutcomes.filter((outcome) => itemIds.has(outcome.savedItemId)),
  );
  for (const outcome of itemOutcomes) {
    if (
      outcome.destinationKind === "general_action" &&
      !actionIds.has(outcome.destinationRecordId)
    ) {
      throw new Error(
        `Owner data export Saved Item ${outcome.savedItemId} references General Action ${outcome.destinationRecordId} outside the owner export.`,
      );
    }
  }
  const ideas = sortById(input.giftIdeas.filter((idea) => planIds.has(idea.giftPlanId)));
  for (const plan of plans) {
    if (plan.subjectPersonId && !personIds.has(plan.subjectPersonId)) {
      throw new Error(
        `Owner data export Gift Plan ${plan.id} references Person ${plan.subjectPersonId} outside the owner export.`,
      );
    }
  }
  const planEvents = sortByCreatedAt(
    input.giftPlanEvents.filter((event) => planIds.has(event.giftPlanId)),
  );
  const recordIdsByKind = new Map<string, Set<string>>([
    ["general_action", actionIds],
    ["saved_item", itemIds],
    ["gift_plan", planIds],
  ]);
  const shares = sortById(
    input.recordShares.filter((share) =>
      recordIdsByKind.get(share.recordKind)?.has(share.recordId),
    ),
  );

  return {
    generalActions: actions,
    generalActionAreas: areas,
    generalActionPeople: actionPeople,
    generalActionAssets: actionAssets,
    generalActionEvents: actionEvents,
    savedItems: items,
    savedItemEvents: itemEvents,
    savedItemOutcomes: itemOutcomes,
    messageDrafts: drafts,
    giftPlans: plans,
    giftIdeas: ideas,
    giftPlanEvents: planEvents,
    recordShares: shares,
    sourceRecordIds: [...facts.sourceRecordIds].sort(),
    personIds: [...facts.personIds].sort(),
    memoryIds: [...facts.memoryIds].sort(),
    followupIds: [...facts.followupIds].sort(),
    sensitivityByRecordId: { ...facts.sensitivityByRecordId },
  };
}

export type OwnerDataExportActionsPlanningArchiveExtension = {
  entries: ReturnType<typeof archiveEntry>[];
  resources: OwnerDataExportResource[];
  families: string[];
};

function loadWhenPresent<T>(ids: readonly string[], load: () => Promise<T[]>): Promise<T[]> {
  return ids.length > 0 ? load() : Promise.resolve([]);
}

/** Convert the actions-planning graph into stable, versioned JSON resources. */
export function ownerDataExportActionsPlanningContextExtension(
  ownerUserId: string,
  input: OwnerDataExportActionsPlanningContext,
  grounding?: OwnerDataExportGrounding,
): OwnerDataExportActionsPlanningArchiveExtension {
  const context = filterOwnerDataExportActionsPlanningContext(ownerUserId, input, grounding);
  const facts = buildGrounding(context, grounding);
  const actionSensitivity = sensitivityOf(
    context.generalActions.map((action) => action.sourceRecordId),
    context.generalActions.map((action) =>
      directSensitivity((action as unknown as { sensitivity?: unknown }).sensitivity),
    ),
    facts.sensitivityByRecordId,
  );
  const savedItemSensitivity = sensitivityOf(
    context.savedItems.map((item) => item.sourceRecordId),
    context.savedItems.map((item) =>
      directSensitivity((item as unknown as { sensitivity?: unknown }).sensitivity),
    ),
    facts.sensitivityByRecordId,
  );
  const draftSensitivity = sensitivityOf(
    context.messageDrafts.flatMap((draft) => draft.sourceRefs.map((ref) => ref.id)),
    context.messageDrafts.map((draft) =>
      directSensitivity((draft as unknown as { sensitivity?: unknown }).sensitivity),
    ),
    facts.sensitivityByRecordId,
  );
  const giftSensitivity = maxSensitivity(
    context.giftPlans.map((plan) =>
      directSensitivity((plan as unknown as { sensitivity?: unknown }).sensitivity),
    ),
  );
  const resources = [
    resource(
      "resources/actions/general-actions-v1.json",
      context.generalActions.map(generalActionForExport),
      actionSensitivity,
    ),
    resource(
      "resources/actions/general-action-areas-v1.json",
      context.generalActionAreas.map(areaForExport),
    ),
    resource(
      "resources/actions/general-action-people-v1.json",
      context.generalActionPeople.map(actionPersonForExport),
    ),
    resource(
      "resources/actions/general-action-assets-v1.json",
      context.generalActionAssets.map(actionAssetForExport),
    ),
    resource(
      "resources/actions/general-action-events-v1.json",
      context.generalActionEvents.map(actionEventForExport),
      actionSensitivity,
    ),
    resource(
      "resources/saved-items/saved-items-v1.json",
      context.savedItems.map(savedItemForExport),
      savedItemSensitivity,
    ),
    resource(
      "resources/saved-items/saved-item-events-v1.json",
      context.savedItemEvents.map(savedItemEventForExport),
      savedItemSensitivity,
    ),
    resource(
      "resources/saved-items/saved-item-outcomes-v1.json",
      context.savedItemOutcomes.map(savedItemOutcomeForExport),
      savedItemSensitivity,
    ),
    resource(
      "resources/drafts/message-drafts-v1.json",
      context.messageDrafts.map(draftForExport),
      draftSensitivity,
    ),
    resource(
      "resources/gift-plans/gift-plans-v1.json",
      context.giftPlans.map(giftPlanForExport),
      giftSensitivity,
    ),
    resource(
      "resources/gift-plans/gift-plan-ideas-v1.json",
      context.giftIdeas.map(giftIdeaForExport),
      giftSensitivity,
    ),
    resource(
      "resources/gift-plans/gift-plan-events-v1.json",
      context.giftPlanEvents.map(giftPlanEventForExport),
      giftSensitivity,
    ),
    resource("resources/sharing/record-shares-v1.json", context.recordShares.map(shareForExport)),
  ];

  return {
    entries: resources.map((item) => item.entry),
    resources: resources.map((item) => item.resource),
    families: [
      "General Actions",
      "General Action Areas",
      "Saved Items",
      "Message Drafts",
      "Gift Plans",
      "Share Metadata",
    ],
  };
}

/**
 * Load only durable, member-owned rows in the actions-planning graph. The joins
 * deliberately use ownership/owner predicates rather than visibility: records
 * shared to this owner and Household-native rows are not part of portability.
 */
export async function loadOwnerDataExportActionsPlanningContext(input: {
  ownerUserId: string;
}): Promise<OwnerDataExportActionsPlanningContext> {
  const ownerUserId = input.ownerUserId;
  const db = getDb();
  const [
    actionRows,
    areaRows,
    savedItemRows,
    draftRows,
    planRows,
    sourceIdRows,
    personIdRows,
    memoryIdRows,
    followupIdRows,
  ] = await Promise.all([
    db
      .select()
      .from(generalActions)
      .where(
        and(
          eq(generalActions.ownerUserId, ownerUserId),
          eq(generalActions.ownership, "member_owned"),
        ),
      )
      .orderBy(asc(generalActions.id)),
    db
      .select()
      .from(generalActionAreas)
      .where(eq(generalActionAreas.ownerUserId, ownerUserId))
      .orderBy(asc(generalActionAreas.id)),
    db
      .select()
      .from(savedItems)
      .where(and(eq(savedItems.ownerUserId, ownerUserId), eq(savedItems.ownership, "member_owned")))
      .orderBy(asc(savedItems.id)),
    db
      .select({ draft: messageDrafts })
      .from(messageDrafts)
      .innerJoin(people, eq(messageDrafts.personId, people.id))
      .where(and(eq(messageDrafts.ownerUserId, ownerUserId), eq(people.ownerUserId, ownerUserId)))
      .orderBy(asc(messageDrafts.id)),
    db
      .select()
      .from(giftPlans)
      .where(eq(giftPlans.ownerUserId, ownerUserId))
      .orderBy(asc(giftPlans.id)),
    db
      .select({ id: sourceRecords.id })
      .from(sourceRecords)
      .where(eq(sourceRecords.ownerUserId, ownerUserId))
      .orderBy(asc(sourceRecords.id)),
    db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.ownerUserId, ownerUserId))
      .orderBy(asc(people.id)),
    db
      .select({ id: memories.id })
      .from(memories)
      .where(eq(memories.ownerUserId, ownerUserId))
      .orderBy(asc(memories.id)),
    db
      .select({ id: followups.id })
      .from(followups)
      .where(eq(followups.ownerUserId, ownerUserId))
      .orderBy(asc(followups.id)),
  ]);

  const actions = actionRows as unknown as GeneralAction[];
  const actionIds = actions.map((action) => action.id);
  const savedItemsForOwner = savedItemRows as unknown as SavedItem[];
  const savedItemIds = savedItemsForOwner.map((item) => item.id);
  const plans = planRows as unknown as GiftPlan[];
  const planIds = plans.map((plan) => plan.id);
  const ids = [...actionIds, ...savedItemIds, ...planIds];

  const [
    actionPeopleRows,
    actionAssetRows,
    actionEventRows,
    savedEventRows,
    savedOutcomeRows,
    ideaRows,
    planEventRows,
    shareRows,
  ] = await Promise.all([
    loadWhenPresent(actionIds, () =>
      db
        .select({ link: generalActionPeople })
        .from(generalActionPeople)
        .innerJoin(generalActions, eq(generalActionPeople.generalActionId, generalActions.id))
        .where(
          and(
            eq(generalActions.ownerUserId, ownerUserId),
            eq(generalActions.ownership, "member_owned"),
            inArray(generalActionPeople.generalActionId, actionIds),
          ),
        )
        .orderBy(asc(generalActionPeople.id)),
    ),
    loadWhenPresent(actionIds, () =>
      db
        .select({ link: generalActionAssets })
        .from(generalActionAssets)
        .innerJoin(generalActions, eq(generalActionAssets.generalActionId, generalActions.id))
        .where(
          and(
            eq(generalActions.ownerUserId, ownerUserId),
            eq(generalActions.ownership, "member_owned"),
            inArray(generalActionAssets.generalActionId, actionIds),
          ),
        )
        .orderBy(asc(generalActionAssets.id)),
    ),
    loadWhenPresent(actionIds, () =>
      db
        .select({ event: generalActionEvents })
        .from(generalActionEvents)
        .innerJoin(generalActions, eq(generalActionEvents.generalActionId, generalActions.id))
        .where(
          and(
            eq(generalActionEvents.ownerUserId, ownerUserId),
            eq(generalActions.ownerUserId, ownerUserId),
            eq(generalActions.ownership, "member_owned"),
            inArray(generalActionEvents.generalActionId, actionIds),
          ),
        )
        .orderBy(asc(generalActionEvents.createdAt), asc(generalActionEvents.id)),
    ),
    loadWhenPresent(savedItemIds, () =>
      db
        .select({ event: savedItemEvents })
        .from(savedItemEvents)
        .innerJoin(savedItems, eq(savedItemEvents.savedItemId, savedItems.id))
        .where(
          and(
            eq(savedItemEvents.ownerUserId, ownerUserId),
            eq(savedItems.ownerUserId, ownerUserId),
            eq(savedItems.ownership, "member_owned"),
            inArray(savedItemEvents.savedItemId, savedItemIds),
          ),
        )
        .orderBy(asc(savedItemEvents.createdAt), asc(savedItemEvents.id)),
    ),
    loadWhenPresent(savedItemIds, () =>
      db
        .select({ outcome: savedItemOutcomes })
        .from(savedItemOutcomes)
        .innerJoin(savedItems, eq(savedItemOutcomes.savedItemId, savedItems.id))
        .where(
          and(
            eq(savedItems.ownerUserId, ownerUserId),
            eq(savedItems.ownership, "member_owned"),
            inArray(savedItemOutcomes.savedItemId, savedItemIds),
          ),
        )
        .orderBy(asc(savedItemOutcomes.createdAt), asc(savedItemOutcomes.id)),
    ),
    loadWhenPresent(planIds, () =>
      db
        .select({ idea: giftIdeas })
        .from(giftIdeas)
        .innerJoin(giftPlans, eq(giftIdeas.giftPlanId, giftPlans.id))
        .where(and(eq(giftPlans.ownerUserId, ownerUserId), inArray(giftIdeas.giftPlanId, planIds)))
        .orderBy(asc(giftIdeas.id)),
    ),
    loadWhenPresent(planIds, () =>
      db
        .select({ event: giftPlanEvents })
        .from(giftPlanEvents)
        .innerJoin(giftPlans, eq(giftPlanEvents.giftPlanId, giftPlans.id))
        .where(
          and(eq(giftPlans.ownerUserId, ownerUserId), inArray(giftPlanEvents.giftPlanId, planIds)),
        )
        .orderBy(asc(giftPlanEvents.createdAt), asc(giftPlanEvents.id)),
    ),
    loadWhenPresent(ids, () =>
      db
        .select()
        .from(householdRecordShares)
        .where(
          and(
            inArray(householdRecordShares.recordKind, [
              "general_action",
              "saved_item",
              "gift_plan",
            ]),
            inArray(householdRecordShares.recordId, ids),
          ),
        )
        .orderBy(asc(householdRecordShares.id)),
    ),
  ]);

  return {
    generalActions: actions,
    generalActionAreas: areaRows as unknown as GeneralActionArea[],
    generalActionPeople: actionPeopleRows.map((row) => row.link),
    generalActionAssets: actionAssetRows.map(
      (row) => row.link,
    ) as unknown as GeneralActionAssetLink[],
    generalActionEvents: actionEventRows.map((row) => row.event) as unknown as GeneralActionEvent[],
    savedItems: savedItemsForOwner,
    savedItemEvents: savedEventRows.map((row) => row.event) as unknown as SavedItemEvent[],
    savedItemOutcomes: savedOutcomeRows.map((row) => row.outcome) as unknown as SavedItemOutcome[],
    messageDrafts: draftRows.map((row) => row.draft) as unknown as MessageDraft[],
    giftPlans: plans,
    giftIdeas: ideaRows.map((row) => row.idea) as unknown as GiftIdea[],
    giftPlanEvents: planEventRows.map((row) => row.event) as unknown as GiftPlanEvent[],
    recordShares: shareRows as unknown as HouseholdRecordShare[],
    sourceRecordIds: sourceIdRows.map((row) => row.id),
    personIds: personIdRows.map((row) => row.id),
    memoryIds: memoryIdRows.map((row) => row.id),
    followupIds: followupIdRows.map((row) => row.id),
  };
}
