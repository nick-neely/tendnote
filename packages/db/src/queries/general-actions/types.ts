import type {
  CreateGeneralActionEventInput,
  CreateGeneralActionInput,
  GeneralAction,
  GeneralActionAssetHint,
  GeneralActionEdit,
  GeneralActionEvent,
  GeneralActionLink,
  GeneralActionOfferKind,
  GeneralActionOwnership,
  GeneralActionProgressReconciliation,
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
    | "ownership"
    | "responsibilityHolderUserId"
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
  /**
   * Applies a patch **only if** the record's occurrence fence still reads
   * `expectedOccurrenceVersion`, bumping it in the same statement, and returns
   * `null` when it does not.
   *
   * A separate method rather than a flag on `updateGeneralAction` because the
   * conditional write is the whole contract: two members completing the same bin
   * day must produce one roll-forward, and a read-then-write pair cannot promise
   * that however carefully it is ordered. `null` means "someone else got there
   * first" — never an error, because arriving second is not a failure — and the
   * lifecycle reconciles against authoritative state from there.
   */
  advanceGeneralActionOccurrence: (input: {
    ownerUserId: string;
    generalActionId: string;
    expectedOccurrenceVersion: number;
    patch: GeneralActionPatch;
  }) => Promise<GeneralAction | null>;
  createGeneralActionEvent: (input: CreateGeneralActionEventInput) => Promise<GeneralActionEvent>;
  listGeneralActionEvents: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<GeneralActionEvent[]>;
  /**
   * The household's own Actions and Routines, by ownership form. The access path
   * for the Household home (#384) and for the departure and dissolution sweeps,
   * which have a household id and no member to key on.
   */
  listGeneralActionsForHousehold: (input: {
    householdId: string;
    ownership?: GeneralActionOwnership;
    statuses?: GeneralActionStatus[];
  }) => Promise<GeneralAction[]>;
  /**
   * Clears every household-native record naming this member as its
   * Responsibility Holder, and names no replacement. Returns the records it
   * touched so the caller can invalidate their reminders in the same
   * transaction (ADR 0215).
   */
  clearResponsibilityHolderForMember: (input: {
    householdId: string;
    userId: string;
  }) => Promise<GeneralAction[]>;
  /**
   * Returns a departing member's own shared/household-scope Actions to
   * `private`, so what they wrote leaves with them rather than staying visible
   * to a household they are no longer in. Ownership is untouched — this is
   * access ending, not a transfer.
   */
  revertMemberOwnedGeneralActionsToPrivate: (input: {
    householdId: string;
    ownerUserId: string;
  }) => Promise<GeneralAction[]>;
  /** The members who have already answered no to one of a record's offers. */
  listGeneralActionOfferDeclines: (input: {
    generalActionId: string;
    offerKind: GeneralActionOfferKind;
  }) => Promise<string[]>;
  /** Remembers one member's "no thanks", so that offer is never made again. */
  declineGeneralActionOffer: (input: {
    generalActionId: string;
    userId: string;
    offerKind: GeneralActionOfferKind;
  }) => Promise<void>;
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
  GeneralActionAuthorityStore &
  // Both grounding reads, because which one applies is decided by the record's
  // ownership form rather than by the store: a member-owned Action's grounding
  // is owner-keyed, a household-native one's is read by household visibility
  // (see {@link resolveSourceRecordId}).
  Pick<SourceRecordResolutionStore, "getSourceRecord" | "getVisibleSourceRecord" | "getPerson"> &
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

/**
 * The two reads the Household Authorization Proof is built from. Named here so
 * the lifecycle store's dependency on the proof is visible in its type rather
 * than buried in a constructor (ADR 0219).
 */
export type GeneralActionAuthorityStore = Pick<
  HouseholdStore,
  "listActiveHouseholdMembershipsForUser" | "listHouseholdRecordSharesForRecords"
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

/**
 * A progress action's outcome: authoritative state, plus an account of what
 * happened when it was not what the caller asked for.
 *
 * Progress is reconciled rather than refused, so a stale tap is never an error —
 * it produced no second advance, and the member is handed the settled record
 * along with who settled it and when. Deliberately the action view *widened*
 * rather than a wrapper around it: `reconciliation` is null on every ordinary
 * completion, so a caller that ignores the field behaves exactly as it did
 * before household sharing existed, and only the surfaces that can say something
 * useful about a race have to know a race is possible.
 */
export type GeneralActionProgressOutcome = GeneralActionWithContext & {
  reconciliation: (GeneralActionProgressReconciliation & { handledByUserId: string | null }) | null;
};

export type CreateActiveGeneralActionInput = {
  /** Optional stable id for an idempotent cross-domain promotion. */
  id?: string;
  /**
   * The creating member. For a household-native record this becomes the row's
   * storage key and its creator provenance, and confers no authority (ADR 0214).
   */
  ownerUserId: string;
  /**
   * Whose record this is. `household_native` requires `scope: "household"` and
   * the creator's active membership, and is the answer to the creation question
   * "who is this for" when the member chooses **Our household** — because that
   * is what a shared chore almost always means.
   */
  ownership?: GeneralActionOwnership;
  /** The active member named as looking after a household-native record. */
  responsibilityHolderUserId?: string | null;
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

/**
 * A progress action, optionally fenced on the occurrence the member actually saw.
 *
 * The fence is optional rather than required because a private Action has
 * nobody to race with, and because a programmatic caller acting on the current
 * state has no rendered occurrence to name. Every collaborative surface passes
 * it: it is what turns "someone else already did this" from a silent double
 * advance into a sentence.
 */
export type GeneralActionProgressInput = GeneralActionActionInput & {
  expectedOccurrenceVersion?: number;
};

/**
 * Names, changes, or clears who is looking after a household-native record.
 *
 * `handedOff` marks the one-tap hand-off offered at completion, which is the
 * same write with a different story in history. There is no "advance to the next
 * member" input and never will be: a stored turn order is exactly the fairness
 * claim Tendnote refuses to manufacture (ADR 0215).
 */
export type SetResponsibilityHolderInput = GeneralActionActionInput & {
  holderUserId: string | null;
  handedOff?: boolean;
  /**
   * Whether the outgoing holder's own Reminder Schedule for this record should
   * go with the hand-off. Honoured only when the acting member *is* the outgoing
   * holder, because removing an alert from another member's device is that
   * member's choice to make, not a side effect of someone else's edit (ADR 0203).
   */
  removeOutgoingReminder?: boolean;
};

/**
 * Hands a member-owned record over to the household, in place and one-way.
 *
 * Deliberately separate from re-scoping: widening an Action to household
 * visibility says "you can see this", and this says "this is ours now, it stays
 * here if I leave, and you can edit it". There is no inverse, because reversing
 * it would mean deciding which member wins a record the workspace owns
 * (ADR 0214).
 */
export type HandGeneralActionToHouseholdInput = GeneralActionActionInput & {
  responsibilityHolderUserId?: string | null;
};

export type DeferGeneralActionInput = GeneralActionActionInput & {
  deferUntil: Date;
};

/** State-aware inverse for a completed or skipped Routine occurrence. */
export type UndoRoutineOccurrenceInput = GeneralActionActionInput & {
  expectedDueAt: Date;
  restoreDueAt: Date;
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
