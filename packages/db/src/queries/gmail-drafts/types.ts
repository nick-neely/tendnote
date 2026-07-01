import type {
  GmailDraftAction,
  GmailDraftActionKind,
  GmailDraftActionStatus,
  GmailDraftRecipient,
} from "@tendnote/domain";

/** Audit entry shape shared with the source-record/provider-connection stores. */
export type GmailDraftAuditLogEntry = {
  ownerUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown>;
};

/**
 * Minimized create/update request handed to the Gmail provider adapter. Carries
 * only the confirmed `to` address, approved subject, and approved body — no CC,
 * BCC, or attachments (ADR-0095). The body is read from the Tendnote draft at write
 * time and never persisted on the action record (ADR-0086, ADR-0094).
 */
export type GmailDraftAdapterCreateInput = {
  ownerUserId: string;
  to: string;
  subject: string;
  body: string;
};

export type GmailDraftAdapterUpdateInput = GmailDraftAdapterCreateInput & {
  /** The existing Gmail draft id to update in place (ADR-0088). */
  gmailDraftId: string;
};

/** The minimized provider response Tendnote retains: the Gmail draft id only. */
export type GmailDraftAdapterResult = {
  gmailDraftId: string;
};

/**
 * Replaceable Gmail provider adapter (ADR-0084, ADR-0097). Exposes ONLY draft
 * create/update — there is intentionally no send, read, list, or history method,
 * so the no-send/no-read boundary is structural, not merely policy (ADR-0089).
 * Normal tests inject a fake so they never call Google; the live Google adapter is
 * injected only where an owner token is available.
 */
export type GmailDraftAdapter = {
  createDraft: (input: GmailDraftAdapterCreateInput) => Promise<GmailDraftAdapterResult>;
  updateDraft: (input: GmailDraftAdapterUpdateInput) => Promise<GmailDraftAdapterResult>;
};

/** Full row the store persists. Every field is minimized non-secret state. */
export type PersistGmailDraftActionInput = {
  ownerUserId: string;
  messageDraftId: string;
  providerKey: string;
  capabilityKey: string;
  kind: GmailDraftActionKind;
  status: GmailDraftActionStatus;
  subject: string;
  recipient: GmailDraftRecipient;
  gmailDraftId: string | null;
  version: number;
  idempotencyKey: string;
  lastErrorMessage: string | null;
};

/** Defined-only mutable columns handed to the store (undefined keys are dropped). */
export type GmailDraftActionPatch = Partial<
  Pick<PersistGmailDraftActionInput, "status" | "gmailDraftId" | "lastErrorMessage" | "version">
>;

export type GmailDraftActionStore = {
  createAction: (values: PersistGmailDraftActionInput) => Promise<GmailDraftAction>;
  getAction: (input: { ownerUserId: string; actionId: string }) => Promise<GmailDraftAction | null>;
  updateAction: (input: {
    ownerUserId: string;
    actionId: string;
    patch: GmailDraftActionPatch;
  }) => Promise<GmailDraftAction | null>;
  /** All of an owner's actions for one Tendnote draft, newest first. */
  listActionsForDraft: (input: {
    ownerUserId: string;
    messageDraftId: string;
  }) => Promise<GmailDraftAction[]>;
  /** Dedupe lookup so a retried/refreshed submission never double-writes Gmail. */
  findByIdempotencyKey: (input: {
    ownerUserId: string;
    idempotencyKey: string;
  }) => Promise<GmailDraftAction | null>;
  createAuditLogEntry: (entry: GmailDraftAuditLogEntry) => Promise<void>;
};

/**
 * Reads the exact approved Tendnote draft snapshot the Gmail write uses (ADR-0086).
 * The service reads the body from the source-of-truth draft row at write time
 * rather than trusting a passed-in body, so approval-flow edits must already be
 * persisted through the draft lifecycle before the external write.
 */
export type GmailDraftBodySource = {
  getDraftBody: (input: {
    ownerUserId: string;
    messageDraftId: string;
  }) => Promise<{ body: string } | null>;
};

/**
 * Precondition gate for an external Gmail write. Later slices compose the real
 * checks here — a connected `google/gmail` capability (#121) and an explicit
 * approval artifact (#122) — so web and Eve share one policy boundary and cannot
 * fork it. Returning `{ ok: false }` yields a `blocked` outcome that leaves the
 * Tendnote draft intact and writes no external-action row. Defaults to allow so the
 * foundation and its tests need no wiring.
 */
export type GmailDraftAuthorizeInput = {
  ownerUserId: string;
  messageDraftId: string;
  kind: GmailDraftActionKind;
  recipient: GmailDraftRecipient;
  subject: string;
};

export type GmailDraftAuthorizeResult = { ok: true } | { ok: false; reason: string };

export type GmailDraftAuthorize = (
  input: GmailDraftAuthorizeInput,
) => Promise<GmailDraftAuthorizeResult>;
