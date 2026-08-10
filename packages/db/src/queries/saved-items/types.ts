import type {
  MemberOwnedSavedItem,
  CreateSavedItemInput as PersistedCreateSavedItemInput,
  PrivacyScope,
  SavedItem,
  SavedItemEdit,
  SavedItemEvent,
  SavedItemEventKind,
  SavedItemOutcome,
} from "@tendnote/domain";
import type { MutationOutcome } from "../affected-scopes";
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

/** What hydration adds to a stored Saved Item, whichever ownership form it has. */
export type SavedItemContext = {
  sharedWithUserIds: string[];
  householdName: string | null;
  outcomes: SavedItemOutcome[];
};

export type SavedItemWithContext = SavedItem & SavedItemContext;

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
  /**
   * The owner-keyed read. Its result carries the owner in its type because the
   * query was keyed by one: a household-native record cannot come back from
   * here, so the owner-scoped paths downstream need no null handling.
   */
  getSavedItem: (input: {
    ownerUserId: string;
    savedItemId: string;
  }) => Promise<MemberOwnedSavedItem | null>;
  getVisibleSavedItem: (input: {
    callerUserId: string;
    savedItemId: string;
  }) => Promise<SavedItem | null>;
  /** Owner-keyed like its read, and owner-carrying for the same reason. */
  updateSavedItem: (input: {
    ownerUserId: string;
    savedItemId: string;
    patch: SavedItemPatch;
  }) => Promise<MemberOwnedSavedItem>;
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
  /**
   * Reads one Saved Item by id alone, with no caller or owner in the key.
   *
   * The household-native boundary needs the record's stored facts *before* it
   * can ask the Household Authorization Proof about them, and an owner-keyed
   * read cannot find a record that has no owner. It is deliberately the only
   * unkeyed read here: nothing outside
   * {@link createHouseholdSavedItemCollaboration} may call it, and everything
   * that does proves the caller against what it returns before returning
   * anything to them.
   */
  getSavedItemById: (input: { savedItemId: string }) => Promise<SavedItem | null>;
  /**
   * The versioned household-native write. `null` back means the record moved
   * under the caller - a different version, a different ownership form, or gone
   * - and the caller reconciles rather than retrying.
   */
  updateHouseholdNativeSavedItem: (input: {
    savedItemId: string;
    expectedVersion: number;
    patch: SavedItemPatch;
  }) => Promise<SavedItem | null>;
  createSavedItemEvent: (input: {
    id?: string;
    savedItemId: string;
    /** Null for a household-native item; `actorUserId` still names who acted. */
    ownerUserId: string | null;
    kind: SavedItemEventKind;
    actorUserId: string | null;
    detailJson?: Record<string, unknown>;
  }) => Promise<SavedItemEvent>;
  listSavedItemEvents: (input: {
    ownerUserId: string | null;
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
    // The two reads the Household Authorization Proof is built from. Included
    // here so the collaboration boundary constructs its prover from the same
    // store it reads records with, rather than reaching for a global one that a
    // test could not substitute (ADR 0219).
    | "listHouseholdRecordSharesForRecords"
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

/**
 * What an active member supplies to write a household-native Saved Item.
 *
 * There is no `ownerUserId` and no visibility choice: the workspace owns it and
 * the whole household sees it, by definition of the form (ADR 0214). The
 * household is named rather than inferred so the proof has something concrete to
 * refuse, and `actorUserId` becomes the record's creator and first actor.
 */
export type CreateHouseholdSavedItemInput = {
  id?: string;
  createdEventId?: string;
  actorUserId: string;
  householdId: string;
  kind: SavedItem["kind"];
  title: string;
  content?: string | null;
  url?: string | null;
  bringBackAt?: Date | null;
  bringBackTimeSemantics?: SavedItem["bringBackTimeSemantics"];
  originalText?: string;
  sourceRecordId?: string;
};

/** A household-native write, with the version the member had in front of them. */
export type HouseholdSavedItemMutationInput = {
  actorUserId: string;
  savedItemId: string;
  /** Omitted only after the member has answered a conflict and chosen to replace. */
  expectedVersion?: number;
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
  }) => Promise<MutationOutcome<{ id: string }>>;
  /**
   * Creates the household-native General Action a household-native promotion
   * lands in. Separate from {@link SavedItemLifecycleDeps.createGeneralAction}
   * because the two produce different ownership forms and a single function that
   * chose between them by flag is exactly the implicit transfer this domain
   * refuses.
   *
   * Production supplies it (see `queries/saved-items.ts`). It stays optional so
   * the fail-closed direction is the default one: a boundary composed without it
   * refuses the destination outright rather than quietly landing a
   * workspace-owned Saved Item in a member's own Action, which would hand the
   * household's record to whoever pressed promote.
   */
  createHouseholdNativeGeneralAction?: (input: {
    id: string;
    householdId: string;
    createdByUserId: string;
    title: string;
    notes: string | null;
    sourceRecordId: string;
  }) => Promise<MutationOutcome<{ id: string }>>;
};
