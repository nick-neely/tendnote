import type {
  CreateGeneralActionEventInput,
  CreateGeneralActionInput,
  GeneralAction,
  GeneralActionAssetHint,
  GeneralActionEdit,
  GeneralActionEvent,
  GeneralActionLink,
  GeneralActionStatus,
  Person,
  PrivacyScope,
} from "@tendnote/domain";
import type { GeneralActionAreaStore } from "../general-action-areas/types";
import type { HouseholdStore } from "../households/types";
import type {
  InMemorySourceRecordStore,
  SourceRecordResolutionStore,
} from "../source-records/types";

/** Bounded patch the lifecycle layer may apply to a persisted General Action. */
export type GeneralActionPatch = Partial<
  Pick<
    GeneralAction,
    | "title"
    | "notes"
    | "dueAt"
    | "deferUntil"
    | "links"
    | "assetHints"
    | "status"
    | "areaId"
    | "scope"
    | "householdId"
    | "completedAt"
    | "lastActorUserId"
  >
>;

/**
 * A linked person named for display, carrying nothing but id + display name (ADR
 * 0155). Resolved owner-scoped against the Action's owner so a viewing household
 * member sees the context the owner chose to attach, never raw ids or other
 * owner-scoped person fields.
 */
export type GeneralActionPersonRef = Pick<Person, "id" | "displayName">;

/**
 * A persisted Action hydrated for a surface read: its optional people links, and the
 * audience detail behind its scope so the surface can say *who* can see it, not just
 * that it is shared. Links are context, not a Follow-Up conversion — a linked person
 * never pulls the Action into a person's follow-up flow (ADR 0155).
 */
export type GeneralActionWithContext = GeneralAction & {
  linkedPeople: GeneralActionPersonRef[];
  /** How many members a `shared` Action is shared with; 0 for other scopes. */
  sharedWithCount: number;
  /** The household's name for a `shared`/`household` Action, when one exists. */
  householdName: string | null;
};

/**
 * Owner-scoped General Action CRUD plus lifecycle-history writes/reads and the
 * scope-visibility read seam. Owner-keyed methods let a caller touch only their own
 * actions; the `Visible` methods widen reads to any action the caller may see under
 * the Phase 4 scope rules (private = owner; household = active members; shared =
 * owner + selected members). People links are a lightweight join kept beside the
 * action (ADR 0155). This store composes with a household store so scope filtering
 * and shares live behind one seam (AGENTS.md owner-scoped seams; ADR 0153).
 */
export type GeneralActionStore = {
  createGeneralAction: (input: CreateGeneralActionInput) => Promise<GeneralAction>;
  getGeneralAction: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<GeneralAction | null>;
  /** Loads an action the caller may see under scope rules, whoever owns it (ADR 0153). */
  getVisibleGeneralAction: (input: {
    callerUserId: string;
    generalActionId: string;
  }) => Promise<GeneralAction | null>;
  updateGeneralAction: (input: {
    ownerUserId: string;
    generalActionId: string;
    patch: GeneralActionPatch;
  }) => Promise<GeneralAction>;
  /**
   * Lists the owner's actions (optionally filtered by status) ordered by surfacing
   * time: `coalesce(deferUntil, dueAt)` ascending with unscheduled rows (both null)
   * last, then most-recently-created as a stable tiebreak. Both store
   * implementations MUST honor this one ordering contract so the surface behaves
   * identically in tests and production.
   */
  listGeneralActionsForOwner: (input: {
    ownerUserId: string;
    statuses?: GeneralActionStatus[];
    limit?: number;
  }) => Promise<GeneralAction[]>;
  /**
   * Lists every action the caller may see under scope rules — their own plus
   * household and selected-shared actions owned by active co-members — with the same
   * surfacing-time ordering. Scope filtering happens here, pre-retrieval, so nothing
   * out of scope ever reaches the surface (#178/#180).
   */
  listVisibleGeneralActionsForCaller: (input: {
    callerUserId: string;
    statuses?: GeneralActionStatus[];
    limit?: number;
  }) => Promise<GeneralAction[]>;
  /**
   * Replaces an action's people links with exactly `personIds` (ADR 0155). Owner-keyed
   * like every other write: the link set only changes when `ownerUserId` owns the
   * action, so a direct store caller can't rewrite another owner's links.
   */
  setGeneralActionPeople: (input: {
    ownerUserId: string;
    generalActionId: string;
    personIds: string[];
  }) => Promise<void>;
  /**
   * The person ids linked to an action, for hydrating a surface read. Owner-keyed —
   * returns `[]` for an action `ownerUserId` does not own.
   */
  listGeneralActionPersonIds: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<string[]>;
  createGeneralActionEvent: (input: CreateGeneralActionEventInput) => Promise<GeneralActionEvent>;
  listGeneralActionEvents: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<GeneralActionEvent[]>;
};

/**
 * The lifecycle store: the General Action CRUD/history/visibility store plus
 * source-record grounding lookup, owner-scoped person resolution (for verifying and
 * naming people links), Area resolution, and the household scope/shares surface, so
 * grounding, links, an assigned Area, and a visibility scope can each be verified
 * before they are attached (ADRs 0146, 0153, 0154, 0155, 0164). Mirrors the
 * Follow-Up lifecycle-store composition so surfaces share one owner-scoped seam.
 */
export type GeneralActionLifecycleStore = GeneralActionStore &
  Pick<SourceRecordResolutionStore, "getSourceRecord" | "getPerson"> &
  Pick<GeneralActionAreaStore, "getArea"> &
  Pick<
    HouseholdStore,
    | "getHouseholdWorkspace"
    | "getHouseholdMembership"
    | "listHouseholdMemberships"
    | "createHouseholdRecordShare"
    | "listHouseholdRecordShares"
    | "deleteHouseholdRecordShares"
  >;

export type InMemoryGeneralActionLifecycleStore = InMemorySourceRecordStore &
  GeneralActionStore &
  GeneralActionAreaStore &
  HouseholdStore;

export type GeneralActionActionInput = {
  /** The acting user. For a private action this is the owner; for a household or
   * selected-shared one it may be any member who can see the action (ADR 0153). */
  ownerUserId: string;
  generalActionId: string;
};

export type CreateActiveGeneralActionInput = {
  ownerUserId: string;
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
  links?: GeneralActionLink[];
  // Lightweight object/asset hints carried before Asset/Object Memory (ADR 0156).
  assetHints?: GeneralActionAssetHint[];
  // Optional people links — context, not a Follow-Up conversion (ADR 0155). Each
  // must be a person the owner owns.
  personIds?: string[];
  // Source grounding where present; verified owner-visible when provided.
  sourceRecordId?: string | null;
  // Primary Area where present; verified owner-visible and active when provided.
  areaId?: string | null;
  // Visibility. Defaults to private, fail-closed (ADR 0153). A non-private scope
  // requires the owner's active household; `shared` also requires selected members.
  scope?: PrivacyScope;
  householdId?: string | null;
  selectedUserIds?: string[];
};

export type EditGeneralActionInput = GeneralActionActionInput & {
  edit: GeneralActionEdit;
};

export type DeferGeneralActionInput = GeneralActionActionInput & {
  deferUntil: Date;
};

/**
 * Re-scopes an Action in place. Only the owner may change visibility — a viewing
 * member can act on an action but never widen or narrow who else can see it. Widening
 * to a non-private scope requires the owner's active household; `shared` also requires
 * selected active members. Narrowing clears the household and every share so the
 * change is fail-closed (#180, ADR 0153).
 */
export type SetGeneralActionVisibilityInput = GeneralActionActionInput & {
  scope: PrivacyScope;
  householdId?: string | null;
  selectedUserIds?: string[];
};

/** Replaces an Action's people links. The acting user must be able to see the action. */
export type SetGeneralActionPeopleInput = GeneralActionActionInput & {
  personIds: string[];
};

/** Owner-scoped listing input shared by the active and resolved list methods. */
export type ListGeneralActionsInput = {
  ownerUserId: string;
  limit?: number;
};
