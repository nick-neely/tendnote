import type {
  CreateGeneralActionEventInput,
  CreateGeneralActionInput,
  GeneralAction,
  GeneralActionAssetHint,
  GeneralActionEdit,
  GeneralActionEvent,
  GeneralActionLink,
  GeneralActionRecurrence,
  GeneralActionStatus,
  Person,
  PrivacyScope,
  SourceRecord,
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
    | "recurrence"
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

export type CreateGeneralActionBundleInput = {
  action: CreateGeneralActionInput;
  personIds: string[];
  sharedWithUserIds: string[];
  event: Omit<CreateGeneralActionEventInput, "generalActionId">;
};

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
  /**
   * Persists a newly created action, its people/audience links, and its first history
   * event as one unit. Production implements this with one database transaction so a
   * failed attachment can never expose a partial action.
   */
  createGeneralActionBundle: (input: CreateGeneralActionBundleInput) => Promise<GeneralAction>;
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
  /** The acting user, not necessarily the owner. For a private action this is the
   * owner; for a household or selected-shared one it may be any member who can see the
   * action (ADR 0153). Owner keying happens internally off the loaded record — this
   * field only names who is acting (act, not author). */
  actorUserId: string;
  generalActionId: string;
};

export type CreateActiveGeneralActionInput = {
  /** Optional stable id for an idempotent cross-domain promotion. */
  id?: string;
  ownerUserId: string;
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
  // Simple recurrence cadence; present makes the new action a Routine (ADR 0148).
  recurrence?: GeneralActionRecurrence | null;
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

/** Replaces an Action's people links. Owner-only downstream: the acting user must own
 * the action (rewriting whose people it links is an authoring act, not a view-and-act
 * one; ADR 0153, 0155). */
export type SetGeneralActionPeopleInput = GeneralActionActionInput & {
  personIds: string[];
};

/** Owner-scoped listing input shared by the active and resolved list methods. */
export type ListGeneralActionsInput = {
  ownerUserId: string;
  limit?: number;
};

/**
 * Fixed typed component for a Suggested General Action review item, referencing the
 * persisted action and its grounding source record by id so review surfaces reload
 * authoritative records before any accept/edit/dismiss/ignore (ADR 0028, mirroring
 * the suggested-follow-up review component).
 */
export type SuggestedGeneralActionReviewComponent = {
  type: "suggested_general_action_review";
  generalActionId: string;
  sourceRecordId: string | null;
};

/**
 * A Suggested General Action presented for review: the hydrated proposal (with its
 * linked people and scope audience detail) plus the grounding source record, so
 * review surfaces show the editable metadata and *where the proposal came from*
 * without leaking raw ids (ADRs 0151, 0152).
 */
export type SuggestedGeneralActionReviewResult = {
  action: GeneralActionWithContext;
  sourceRecord: SourceRecord | null;
  component: SuggestedGeneralActionReviewComponent;
};

/**
 * Proposes a Suggested General Action: a review-gated `suggested` row grounded in an
 * owner-scoped source record (ADR 0151), carrying the same editable metadata a durable
 * Action does — timing, recurrence, Area, people links, asset hints, and a coarse
 * visibility scope (private or household; a finer selected-shared audience is chosen at
 * acceptance). It never surfaces on the active ledger until accepted.
 */
export type SuggestGeneralActionInput = {
  ownerUserId: string;
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
  deferUntil?: Date | null;
  recurrence?: GeneralActionRecurrence | null;
  links?: GeneralActionLink[];
  assetHints?: GeneralActionAssetHint[];
  personIds?: string[];
  areaId?: string | null;
  // Visibility the proposal argues for. Defaults to private, fail-closed (ADR 0153).
  // `household` requires the proposer's active household; a selected-shared audience is
  // deferred to acceptance, so `shared` is not proposed directly.
  scope?: Exclude<PrivacyScope, "shared">;
  householdId?: string | null;
  // The source record grounding the proposal — required, since a suggestion must be
  // grounded (ADR 0151), mirroring suggested follow-ups.
  sourceRecordId: string;
  // True only when the user directly asked about a delicate context; restricted source
  // records are excluded from proactive suggestion by default (ADR 0058).
  directlyRequested?: boolean;
};

export type ListSuggestedGeneralActionReviewsInput = {
  ownerUserId: string;
  limit?: number;
};

/**
 * Accepts a Suggested General Action, promoting it in place to a durable `open`
 * Action (a Routine when it carries a cadence). An optional edit corrects content
 * before promotion; an optional scope choice finalizes the audience — including a
 * selected-shared one that a bare proposal could not carry. Idempotent: re-accepting
 * an already-promoted proposal is a no-op (ADRs 0151, 0152).
 */
export type AcceptSuggestedGeneralActionInput = GeneralActionActionInput & {
  edit?: GeneralActionEdit;
  scope?: PrivacyScope;
  householdId?: string | null;
  selectedUserIds?: string[];
};

/** Corrects a Suggested General Action's content in place without accepting it. */
export type EditSuggestedGeneralActionInput = GeneralActionActionInput & {
  edit: GeneralActionEdit;
};

/**
 * Enqueues (and, outside production, immediately runs) a semantic-embedding job for a
 * General Action, so it participates in semantic retrieval on write (ADR 0150; Phase 5
 * #184). Injected into the lifecycle and review seams so the same embed-on-write trigger
 * fires from every content-affecting path, mirroring how approved memories embed on save.
 * Defaults to a no-op in stores/tests that do not exercise retrieval.
 */
export type GeneralActionEmbeddingScheduler = (input: {
  ownerUserId: string;
  recordKind: "general_action";
  recordId: string;
}) => Promise<unknown>;

export type GeneralActionLifecycleDeps = {
  scheduleGeneralActionEmbedding?: GeneralActionEmbeddingScheduler;
};
