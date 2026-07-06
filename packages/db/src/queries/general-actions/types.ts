import type {
  CreateGeneralActionEventInput,
  CreateGeneralActionInput,
  GeneralAction,
  GeneralActionEdit,
  GeneralActionEvent,
  GeneralActionLink,
  GeneralActionStatus,
} from "@tendnote/domain";
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
    | "status"
    | "completedAt"
    | "lastActorUserId"
  >
>;

/**
 * Owner-scoped General Action CRUD plus lifecycle-history writes/reads. Every
 * method is keyed on `ownerUserId` so a caller can only ever touch their own
 * actions and history (AGENTS.md owner-scoped seams). Phase 5 #178 is private
 * only, so there is no cross-owner "visible" read seam yet — shared/household
 * visibility arrives additively with #180.
 */
export type GeneralActionStore = {
  createGeneralAction: (input: CreateGeneralActionInput) => Promise<GeneralAction>;
  getGeneralAction: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<GeneralAction | null>;
  updateGeneralAction: (input: {
    ownerUserId: string;
    generalActionId: string;
    patch: GeneralActionPatch;
  }) => Promise<GeneralAction>;
  /**
   * Lists the owner's actions (optionally filtered by status) ordered by
   * surfacing time: `coalesce(deferUntil, dueAt)` ascending with unscheduled rows
   * (both null) last, then most-recently-created as a stable tiebreak. Both store
   * implementations MUST honor this one ordering contract so the surface behaves
   * identically in tests and production.
   */
  listGeneralActionsForOwner: (input: {
    ownerUserId: string;
    statuses?: GeneralActionStatus[];
    limit?: number;
  }) => Promise<GeneralAction[]>;
  createGeneralActionEvent: (input: CreateGeneralActionEventInput) => Promise<GeneralActionEvent>;
  listGeneralActionEvents: (input: {
    ownerUserId: string;
    generalActionId: string;
  }) => Promise<GeneralActionEvent[]>;
};

/**
 * The lifecycle store: the General Action CRUD/history store plus source-record
 * grounding lookup, so a promoted suggestion's grounding can be verified as
 * owner-visible before it is attached (ADRs 0154, 0164). Mirrors the Follow-Up
 * lifecycle-store composition so surfaces share one owner-scoped seam.
 */
export type GeneralActionLifecycleStore = GeneralActionStore &
  Pick<SourceRecordResolutionStore, "getSourceRecord">;

export type InMemoryGeneralActionLifecycleStore = InMemorySourceRecordStore & GeneralActionStore;

export type GeneralActionActionInput = {
  ownerUserId: string;
  generalActionId: string;
};

export type CreateActiveGeneralActionInput = {
  ownerUserId: string;
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
  links?: GeneralActionLink[];
  // Source grounding where present; verified owner-visible when provided.
  sourceRecordId?: string | null;
};

export type EditGeneralActionInput = GeneralActionActionInput & {
  edit: GeneralActionEdit;
};

export type DeferGeneralActionInput = GeneralActionActionInput & {
  deferUntil: Date;
};

/** Owner-scoped listing input shared by the active and resolved list methods. */
export type ListGeneralActionsInput = {
  ownerUserId: string;
  limit?: number;
};
