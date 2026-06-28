import type {
  Brief,
  BriefCadence,
  BriefItem,
  BriefItemKind,
  BriefItemStatus,
  BriefWithItems,
  CreateBriefInput,
} from "@tendnote/domain";
import type {
  InMemorySourceRecordStore,
  SourceRecordResolutionStore,
} from "../source-records/types";

/** Bounded patch the lifecycle layer may apply to a persisted brief item. */
export type BriefItemPatch = Partial<Pick<BriefItem, "status" | "snoozedUntil">>;

/**
 * Postgres-owned persistence seam for persisted briefs (PRD #65, issue #66). This
 * is the shared product foundation every later slice calls — the generator,
 * feedback suppression, manual generation, dashboard rendering, and item actions —
 * so daily, weekly, dashboard, and schedule code never fork brief storage or
 * lifecycle. Generation identity is unique per owner, local date, and cadence:
 * exactly one current (non-superseded) brief exists for that key at a time.
 */
export type BriefStore = {
  // Inserts a brief header and then its item snapshots (header first so items
  // always reference a real brief). Throws if a current brief already exists for
  // the same owner/local date/cadence — callers supersede or return the existing
  // brief first; the generator owns that decision.
  createBrief: (input: CreateBriefInput) => Promise<BriefWithItems>;
  getBrief: (input: { ownerUserId: string; briefId: string }) => Promise<BriefWithItems | null>;
  // The current brief for an owner/local date/cadence, or null. Current means
  // `supersededAt` is null.
  findCurrentBrief: (input: {
    ownerUserId: string;
    localDate: string;
    cadence: BriefCadence;
  }) => Promise<BriefWithItems | null>;
  // Marks the current brief for an owner/local date/cadence as superseded so an
  // explicit regeneration can replace it while the prior brief stays persisted.
  supersedeCurrentBrief: (input: {
    ownerUserId: string;
    localDate: string;
    cadence: BriefCadence;
    supersededAt: Date;
  }) => Promise<Brief | null>;
  getBriefItem: (input: { ownerUserId: string; briefItemId: string }) => Promise<BriefItem | null>;
  updateBriefItem: (input: {
    ownerUserId: string;
    briefItemId: string;
    patch: BriefItemPatch;
  }) => Promise<BriefItem>;
  // Internal query for feedback suppression and audit: brief items across the
  // owner's briefs, optionally filtered by cadence, status, or kind. Never used by
  // render-time code, which reads a specific brief's snapshots instead.
  listBriefItemsForOwner: (input: {
    ownerUserId: string;
    cadence?: BriefCadence;
    statuses?: BriefItemStatus[];
    kinds?: BriefItemKind[];
  }) => Promise<BriefItem[]>;
  // Internal query for audit/history: the owner's briefs, newest first. Excludes
  // superseded briefs unless explicitly requested.
  listBriefsForOwner: (input: {
    ownerUserId: string;
    cadence?: BriefCadence;
    includeSuperseded?: boolean;
  }) => Promise<Brief[]>;
};

/**
 * Brief lifecycle store: the brief persistence seam plus the person/source/audit
 * surface item actions and the generator need. Mirrors how the follow-up review
 * store is composed (PRD #42) so web and schedule callers share one lifecycle
 * layer and every owner-scoped brief-item action is audited.
 */
export type BriefLifecycleStore = BriefStore &
  Pick<SourceRecordResolutionStore, "getPerson" | "getSourceRecord" | "createAuditLogEntry">;

export type InMemoryBriefLifecycleStore = InMemorySourceRecordStore & BriefStore;
