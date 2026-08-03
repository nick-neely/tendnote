import type {
  AssetKind,
  AssetStatus,
  ContextFact,
  ContextFactCategory,
  ContextFactSensitivity,
  ContextFactView,
  ConversationalCaptureClarification,
  ConversationalCaptureConfirmation,
  ConversationalCaptureRequest,
  FollowupStatus,
  GeneralActionRecurrence,
  GeneralActionStatus,
  MemoryStatus,
  PrivacyScope,
  ReminderScheduleChoice,
  SourceRecord,
} from "@tendnote/domain";
import type { AffectedScope, MutationOutcome } from "../../affected-scopes";
import type { SavedItemWithContext } from "../../saved-items/types";

export type ConversationalCaptureInput = ConversationalCaptureRequest;

export type ConversationalCaptureResult = {
  sourceRecord: SourceRecord;
  clarification?: ConversationalCaptureClarification;
  confirmation?: ConversationalCaptureConfirmation;
  savedItem?: SavedItemWithContext;
  generalAction?: CaptureGeneralAction;
  followup?: CaptureFollowup;
  person?: CapturePerson;
  memory?: CaptureMemory;
  assetReview?: CaptureAssetReview;
  contextFact?: ContextFactView;
  outcomes?: CaptureOutcomeResult[];
  reminderSchedule?: ReminderScheduleChoice;
  affectedScopes?: AffectedScope[];
};

export type CaptureGeneralAction = {
  id: string;
  status: GeneralActionStatus;
  sourceRecordId?: string | null;
  recurrence?: GeneralActionRecurrence | null;
};

export type CaptureFollowup = {
  id: string;
  status: FollowupStatus;
  personId?: string;
  sourceRecordId?: string | null;
};

export type ResolvedCapturePerson = { id: string; displayName: string };
export type CapturePerson = ResolvedCapturePerson;
export type CaptureMemory = {
  id: string;
  status: MemoryStatus;
  content?: string;
  personId?: string;
  sourceRecordId?: string | null;
};
export type CaptureAssetReview = {
  asset: { id: string; name: string; status: AssetStatus };
  group: { id: string; sourceRecordId?: string | null };
  component?: {
    type: "asset_review_group";
    groupId: string;
    assetId: string;
    sourceRecordId: string | null;
  };
  duplicateCandidates?: Array<{ id: string; name: string }>;
  evidence?: Array<{ id: string; sourceRecordId?: string | null; reviewGroupId?: string | null }>;
};
type CaptureOutcomeBase = {
  id: string;
  confirmation: Exclude<ConversationalCaptureConfirmation, { destination: "Grouped" }>;
  reminderSchedule?: ReminderScheduleChoice;
  affectedScopes?: AffectedScope[];
};
export type CaptureOutcomeResult =
  | (CaptureOutcomeBase & { kind: "saved_item"; savedItem: SavedItemWithContext })
  | (CaptureOutcomeBase & { kind: "general_action"; generalAction: CaptureGeneralAction })
  | (CaptureOutcomeBase & { kind: "followup"; followup: CaptureFollowup })
  | (CaptureOutcomeBase & { kind: "person"; person: CapturePerson })
  | (CaptureOutcomeBase & { kind: "memory"; memory: CaptureMemory })
  | (CaptureOutcomeBase & {
      kind: "asset_review";
      assetReview: CaptureAssetReview;
      evidence?: CaptureAssetReview["evidence"];
    })
  | (CaptureOutcomeBase & { kind: "context_fact"; contextFact: ContextFactView });

export type CaptureContextFact = Pick<
  ContextFact,
  | "id"
  | "subject"
  | "category"
  | "content"
  | "lifecycle"
  | "sensitivity"
  | "provenance"
  | "updatedAt"
>;

export type CaptureVisibility = {
  scope: PrivacyScope;
  householdId: string | null;
  selectedUserIds: string[];
  label: string;
  captureText: string;
};

export type ConversationalCaptureDeps = {
  resolveOrCreateAndLinkPerson?: (input: {
    ownerUserId: string;
    sourceRecordId: string;
    displayName: string;
    role: "primary";
    unresolvedMentionId?: string;
  }) => Promise<{ person: CapturePerson; created: boolean }>;
  linkSourceRecordToPerson?: (input: {
    ownerUserId: string;
    sourceRecordId: string;
    personId: string;
    role: "primary";
    unresolvedMentionId?: string;
  }) => Promise<{ person: CapturePerson }>;
  createApprovedMemory?: (input: {
    ownerUserId: string;
    personId: string;
    content: string;
    sourceRecordId: string;
    scope: PrivacyScope;
    householdId: string | null;
    selectedUserIds: string[];
  }) => Promise<MutationOutcome<CaptureMemory>>;
  createSuggestedMemory?: (input: {
    ownerUserId: string;
    personId: string;
    content: string;
    sourceRecordId: string;
  }) => Promise<MutationOutcome<CaptureMemory>>;
  suggestAsset?: (input: {
    ownerUserId: string;
    name: string;
    kind: AssetKind;
    scope: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
    sourceRecordId: string;
    directlyRequested: boolean;
    memories: Array<{ label: string; notes: string }>;
    source: "assistant";
  }) => Promise<MutationOutcome<CaptureAssetReview>>;
  addAssetEvidence?: (input: {
    ownerUserId: string;
    reviewGroupId: string;
    kind: "link" | "note";
    label: string;
    url?: string;
    capturedText?: string;
    scope: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
    sourceRecordId: string;
    source: "assistant";
  }) => Promise<
    MutationOutcome<{ id: string; sourceRecordId?: string | null; reviewGroupId?: string | null }>
  >;
  getPerson?: (input: { ownerUserId: string; personId: string }) => Promise<CapturePerson | null>;
  updatePerson?: (input: {
    ownerUserId: string;
    personId: string;
    displayName: string;
  }) => Promise<MutationOutcome<CapturePerson | null>>;
  deleteCapturedPerson?: (input: {
    ownerUserId: string;
    personId: string;
    sourceRecordId: string;
  }) => Promise<MutationOutcome<CapturePerson | null>>;
  unlinkCapturedPerson?: (input: {
    ownerUserId: string;
    personId: string;
    sourceRecordId: string;
  }) => Promise<CapturePerson | null>;
  assertCapturedPersonRemovable?: (input: {
    ownerUserId: string;
    personId: string;
    sourceRecordId: string;
  }) => Promise<void>;
  getMemory?: (input: { ownerUserId: string; memoryId: string }) => Promise<CaptureMemory | null>;
  archiveMemory?: (input: {
    ownerUserId: string;
    memoryId: string;
  }) => Promise<MutationOutcome<CaptureMemory>>;
  getAssetReview?: (input: {
    actorUserId: string;
    groupId: string;
  }) => Promise<CaptureAssetReview | null>;
  findAssetReviewBySource?: (input: {
    ownerUserId: string;
    sourceRecordId: string;
    assetName: string;
  }) => Promise<CaptureAssetReview | null>;
  dismissAssetReview?: (input: {
    actorUserId: string;
    groupId: string;
    source: "assistant";
  }) => Promise<MutationOutcome<CaptureAssetReview>>;
  createGeneralAction?: (input: {
    id: string;
    ownerUserId: string;
    title: string;
    dueAt: Date | null;
    recurrence: GeneralActionRecurrence | null;
    sourceRecordId: string;
    scope: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
  }) => Promise<MutationOutcome<CaptureGeneralAction>>;
  getGeneralAction?: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<CaptureGeneralAction | null>;
  editGeneralAction?: (input: {
    actorUserId: string;
    generalActionId: string;
    edit: {
      title: string;
      dueAt?: Date | null;
      recurrence?: GeneralActionRecurrence | null;
    };
  }) => Promise<MutationOutcome<CaptureGeneralAction>>;
  archiveGeneralAction?: (input: {
    actorUserId: string;
    generalActionId: string;
  }) => Promise<MutationOutcome<CaptureGeneralAction>>;
  editSavedItem?: (input: {
    actorUserId: string;
    savedItemId: string;
    edit: { title: string; content?: string | null; url?: string | null };
  }) => Promise<MutationOutcome<SavedItemWithContext>>;
  archiveSavedItem?: (input: {
    actorUserId: string;
    savedItemId: string;
  }) => Promise<MutationOutcome<SavedItemWithContext>>;
  createFollowup?: (input: {
    id: string;
    ownerUserId: string;
    personId: string;
    reason: string;
    dueAt: Date;
    sourceRecordId: string;
    scope: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
  }) => Promise<MutationOutcome<CaptureFollowup>>;
  getFollowup?: (input: {
    ownerUserId: string;
    followupId: string;
  }) => Promise<CaptureFollowup | null>;
  editFollowup?: (input: {
    actorUserId: string;
    followupId: string;
    edit: { reason: string; dueAt?: Date };
  }) => Promise<MutationOutcome<CaptureFollowup>>;
  archiveFollowup?: (input: {
    actorUserId: string;
    followupId: string;
  }) => Promise<MutationOutcome<CaptureFollowup>>;
  createSelfContextFact?: (input: {
    ownerUserId: string;
    category: Exclude<ContextFactCategory, "composition">;
    content: string;
    sensitivity: ContextFactSensitivity;
    sourceRecordId: string;
  }) => Promise<MutationOutcome<ContextFactView>>;
  getSelfContextFact?: (input: {
    ownerUserId: string;
    contextFactId: string;
  }) => Promise<CaptureContextFact | null>;
  updateSelfContextFact?: (input: {
    actorUserId: string;
    contextFactId: string;
    category: Exclude<ContextFactCategory, "composition">;
    content: string;
    sensitivity: ContextFactSensitivity;
    expectedUpdatedAt?: Date;
  }) => Promise<MutationOutcome<ContextFactView>>;
  archiveSelfContextFact?: (input: {
    actorUserId: string;
    contextFactId: string;
    expectedUpdatedAt?: Date;
  }) => Promise<MutationOutcome<ContextFactView>>;
  searchPeople?: (input: {
    ownerUserId: string;
    query: string;
    limit: number;
  }) => Promise<ResolvedCapturePerson[]>;
  now?: () => Date;
  ownerTimeZone?: (ownerUserId: string) => string | Promise<string>;
  resolveVisibility?: (input: {
    ownerUserId: string;
    originalText: string;
    contextVisibility?: ConversationalCaptureInput["contextVisibility"];
  }) => Promise<CaptureVisibility>;
};
