import type {
  CreateSavedItemInput as PersistedCreateSavedItemInput,
  PrivacyScope,
  SavedItem,
  SavedItemEdit,
  SavedItemEvent,
  SavedItemEventKind,
  SavedItemOutcome,
} from "@tendnote/domain";
import type { HouseholdStore } from "../households/types";
import type { SourceRecordCaptureStore } from "../source-records/types";

export type SavedItemPatch = Partial<
  Pick<
    SavedItem,
    | "title"
    | "content"
    | "url"
    | "status"
    | "bringBackAt"
    | "bringBackTimeSemantics"
    | "scope"
    | "householdId"
    | "resolvedAt"
    | "resolutionReason"
    | "lastActorUserId"
  >
>;

export type SavedItemWithContext = SavedItem & {
  sharedWithUserIds: string[];
  householdName: string | null;
  outcomes: SavedItemOutcome[];
};

export type SourceRecordDependency = {
  recordKind:
    | "memory"
    | "general_action"
    | "followup"
    | "asset_review_group"
    | "asset_memory"
    | "asset_evidence"
    | "asset_link"
    | "person_link"
    | "unresolved_person_mention";
  recordId: string;
};

export type SavedItemStore = {
  createSavedItem: (input: PersistedCreateSavedItemInput) => Promise<SavedItem>;
  getSavedItem: (input: { ownerUserId: string; savedItemId: string }) => Promise<SavedItem | null>;
  getVisibleSavedItem: (input: {
    callerUserId: string;
    savedItemId: string;
  }) => Promise<SavedItem | null>;
  updateSavedItem: (input: {
    ownerUserId: string;
    savedItemId: string;
    patch: SavedItemPatch;
  }) => Promise<SavedItem>;
  listVisibleSavedItems: (input: {
    callerUserId: string;
    statuses?: SavedItem["status"][];
    scopes?: PrivacyScope[];
    limit?: number;
  }) => Promise<SavedItem[]>;
  listSavedItemsBySourceRecord: (input: {
    ownerUserId: string;
    sourceRecordId: string;
  }) => Promise<SavedItem[]>;
  listSourceRecordDependencies: (input: {
    ownerUserId: string;
    sourceRecordId: string;
  }) => Promise<SourceRecordDependency[]>;
  searchVisibleSavedItems: (input: {
    callerUserId: string;
    query: string;
    includeArchived?: boolean;
    limit?: number;
  }) => Promise<SavedItem[]>;
  createSavedItemEvent: (input: {
    id?: string;
    savedItemId: string;
    ownerUserId: string;
    kind: SavedItemEventKind;
    actorUserId: string | null;
    detailJson?: Record<string, unknown>;
  }) => Promise<SavedItemEvent>;
  listSavedItemEvents: (input: {
    ownerUserId: string;
    savedItemId: string;
  }) => Promise<SavedItemEvent[]>;
  createSavedItemOutcome: (
    input: Omit<SavedItemOutcome, "id" | "createdAt">,
  ) => Promise<SavedItemOutcome>;
  listSavedItemOutcomes: (input: { savedItemId: string }) => Promise<SavedItemOutcome[]>;
  deleteUniqueSavedItemSourceEvidence: (input: {
    ownerUserId: string;
    sourceRecordId: string;
    savedItemId: string;
  }) => Promise<void>;
};

export type SavedItemLifecycleStore = SavedItemStore &
  Pick<
    SourceRecordCaptureStore,
    | "createSourceRecord"
    | "getSourceRecord"
    | "updateSourceRecordStatus"
    | "createUnresolvedMention"
    | "listUnresolvedMentions"
  > &
  Pick<
    HouseholdStore,
    | "getHouseholdWorkspace"
    | "getHouseholdMembership"
    | "listHouseholdMemberships"
    | "listActiveHouseholdMembershipsForUser"
    | "createHouseholdRecordShare"
    | "listHouseholdRecordShares"
    | "deleteHouseholdRecordShares"
  > & {
    createSourceRecordAuditLogEntry: SourceRecordCaptureStore["createAuditLogEntry"];
  };

export type CreateSavedItemInput = {
  id?: string;
  createdEventId?: string;
  ownerUserId: string;
  kind: SavedItem["kind"];
  title: string;
  content?: string | null;
  url?: string | null;
  bringBackAt?: Date | null;
  bringBackTimeSemantics?: SavedItem["bringBackTimeSemantics"];
  originalText?: string;
  sourceRecordId?: string;
  scope?: PrivacyScope;
  householdId?: string | null;
  selectedUserIds?: string[];
};

export type EditSavedItemInput = {
  actorUserId: string;
  savedItemId: string;
  edit: SavedItemEdit;
};

export type SavedItemLifecycleDeps = {
  scheduleEmbedding?: (input: {
    ownerUserId: string;
    recordKind: "saved_item";
    recordId: string;
  }) => Promise<unknown>;
  createGeneralAction?: (input: {
    id: string;
    ownerUserId: string;
    title: string;
    notes: string | null;
    sourceRecordId: string;
    scope: PrivacyScope;
    householdId: string | null;
    selectedUserIds: string[];
  }) => Promise<{ id: string }>;
};
