import { z } from "zod";
import { privacyScopeSchema } from "./privacy";

/**
 * A user-actionable validation failure in the Asset lifecycle (an invalid
 * transition, an archived-asset edit). Its `message` is curated and safe to show
 * the user, mirroring `GeneralActionValidationError` so surfaces can render it
 * inline instead of a generic error.
 */
export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetValidationError";
  }
}

/**
 * The small fixed Asset Kind set (Phase 6 #196/#197). Kinds cover practical
 * owner- or household-scoped resources only — an Asset is never a person, a
 * project, a document library, or a generic object. Fixed on purpose: no custom
 * categories, nested folders, or tags, so Eve and the UI can behave appropriately
 * per kind without the user managing a taxonomy.
 */
export const assetKindSchema = z.enum([
  "item",
  "appliance",
  "vehicle",
  "subscription",
  "service",
  "property",
]);
export type AssetKind = z.infer<typeof assetKindSchema>;

/**
 * The canonical kind labels/descriptions for pickers and chips, so every surface
 * (and, later, Eve) names kinds the same way.
 */
export const ASSET_KIND_OPTIONS: ReadonlyArray<{
  kind: AssetKind;
  label: string;
  description: string;
}> = [
  { kind: "item", label: "Item", description: "A practical thing you keep — tools, gear, parts." },
  {
    kind: "appliance",
    label: "Appliance",
    description: "A fridge, washer, furnace — something with filters, parts, and manuals.",
  },
  {
    kind: "vehicle",
    label: "Vehicle",
    description: "A car, bike, or trailer with registration and maintenance context.",
  },
  {
    kind: "subscription",
    label: "Subscription",
    description: "Something that renews — streaming, memberships, plans.",
  },
  {
    kind: "service",
    label: "Service",
    description: "An ongoing service — internet, lawn care, insurance.",
  },
  {
    kind: "property",
    label: "Property",
    description: "A place anchor — home, apartment, storage unit.",
  },
];

export function assetLabelForKind(kind: AssetKind): string {
  return ASSET_KIND_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
}

/**
 * An Asset's lifecycle state. Archive is the normal inactive path — a sold
 * vehicle or canceled subscription keeps its history without staying active; hard
 * delete stays reserved for correction/privacy cases in a later slice (#196).
 *
 * `suggested` and `dismissed` are the review-gated states (#198): a Suggested
 * Asset is an inferred proposal awaiting review, and `dismissed` is the resolved
 * husk of one the user rejected (or linked to an existing Asset instead). Neither
 * is ever a durable record — see {@link isDurableAssetStatus}.
 */
export const assetStatusSchema = z.enum(["active", "archived", "suggested", "dismissed"]);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

/**
 * The durable statuses — the only ones that are a real Asset. Every scope-visible
 * read (Assets surface, profile, member reads) filters to these, so a proposal is
 * owner-only until accepted and a dismissed proposal disappears entirely,
 * mirroring the General Action review-status rule (ADRs 0151, 0152, 0153).
 */
export const DURABLE_ASSET_STATUSES: readonly AssetStatus[] = ["active", "archived"];

export function isDurableAssetStatus(status: AssetStatus): boolean {
  return DURABLE_ASSET_STATUSES.includes(status);
}

/**
 * The core Asset record: a practical owner- or household-scoped thing Tendnote
 * tracks over time (Phase 6 #197). Deliberately a lightweight anchor — memories,
 * evidence, links, and snapshots are later slices that hang off this seam, so the
 * model here stays name + kind + visibility + lifecycle + provenance.
 */
export const assetSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string().trim().min(1),
  kind: assetKindSchema,
  status: assetStatusSchema.default("active"),
  // Visibility scope (ADR 0153): private = owner only; household = every active
  // member of `householdId`; shared = the owner plus selected members. The Asset's
  // scope is also the broadest allowed visibility for future child records (#196).
  scope: privacyScopeSchema.default("private"),
  householdId: z.string().nullable().default(null),
  // Set when the asset was archived; cleared on restore.
  archivedAt: z.date().nullable().default(null),
  // Creator provenance and actor provenance for lifecycle changes, mirroring
  // General Actions (ADR 0154).
  createdByUserId: z.string().nullable().optional(),
  lastActorUserId: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createAssetSchema = assetSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Asset = z.infer<typeof assetSchema>;
export type CreateAssetInput = z.input<typeof createAssetSchema>;

/**
 * Validates a bounded update patch for a persisted Asset. Deliberately carries
 * **no defaults** — an absent key stays absent instead of being filled, so a
 * status-only patch can never silently reset scope, name, or kind. Mirrors the
 * General Action defaults-free update contract; stores must use this schema, not
 * a partial of the base one.
 */
export const assetUpdateSchema = z
  .object({
    name: z.string().trim().min(1),
    kind: assetKindSchema,
    status: assetStatusSchema,
    scope: privacyScopeSchema,
    householdId: z.string().nullable(),
    archivedAt: z.date().nullable(),
    lastActorUserId: z.string().nullable(),
  })
  .partial();

export type AssetUpdate = z.infer<typeof assetUpdateSchema>;

/**
 * Explicit Asset lifecycle transitions: archive sets an active Asset aside with
 * its history; restore brings an archived one back. The single validated matrix so
 * callers (web and, later, Eve) cannot make invalid status jumps — mirroring the
 * General Action transition matrix.
 */
export type AssetLifecycleAction = "archive" | "restore";

const ASSET_TRANSITIONS: Record<
  AssetLifecycleAction,
  { from: ReadonlySet<AssetStatus>; to: AssetStatus }
> = {
  archive: { from: new Set(["active"]), to: "archived" },
  restore: { from: new Set(["archived"]), to: "active" },
};

/**
 * Resolves the target status for a lifecycle action, rejecting invalid jumps with
 * a clear, user-safe error.
 */
export function resolveAssetTransition(
  current: AssetStatus,
  action: AssetLifecycleAction,
): AssetStatus {
  const rule = ASSET_TRANSITIONS[action];
  if (!rule.from.has(current)) {
    throw new AssetValidationError(`Cannot ${action} an asset that is ${current}.`);
  }
  return rule.to;
}

/**
 * Guards that an Asset's content (name, kind) may still be edited. An archived
 * Asset is read-only history — restore it first, then edit.
 */
export function assertAssetEditable(status: AssetStatus): void {
  if (status !== "active") {
    throw new AssetValidationError(`Cannot edit an asset that is ${status}.`);
  }
}

/**
 * Edit payload for an Asset's user-facing content. `undefined` leaves a field
 * unchanged; only name and kind are content in this slice — visibility changes
 * are a deliberate separate act, never smuggled through an edit.
 */
export const assetEditSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    kind: assetKindSchema.optional(),
  })
  .strict();

export type AssetEdit = z.infer<typeof assetEditSchema>;

/** Whether a validated content edit carries no changes, so a no-op can be rejected. */
export function isEmptyAssetEdit(edit: AssetEdit): boolean {
  return edit.name === undefined && edit.kind === undefined;
}

/**
 * Kinds of internal Asset Audit events. Asset Audit is internal-first — it exists
 * so asset writes can be debugged and future trusted-agent modes held accountable
 * (#196), distinct from any user-facing Asset History. `created`/`edited`/
 * `archived`/`restored` cover the foundation slice's writes; the review slice
 * (#198) appends the proposal trail (`suggested`/`promoted`/`dismissed`), the
 * duplicate-review resolution (`linked_existing`), and the Asset Memory writes
 * (`memory_*`); the evidence slice (#200) appends the capture trail
 * (`evidence_*`). Memory and evidence events stay asset-keyed — the child id
 * rides in `detailJson` — so one trail tells an Asset's whole story.
 */
export const assetAuditEventKindSchema = z.enum([
  "created",
  "edited",
  "archived",
  "restored",
  "suggested",
  "promoted",
  "dismissed",
  "linked_existing",
  "memory_created",
  "memory_suggested",
  "memory_edited",
  "memory_promoted",
  "memory_dismissed",
  "evidence_added",
  "evidence_removed",
]);
export type AssetAuditEventKind = z.infer<typeof assetAuditEventKindSchema>;

/**
 * Where an Asset write originated: a person acting in the product, the assistant
 * acting on explicit instruction, or an automated/system path. Coarse on purpose —
 * provenance detail rides in `detailJson`.
 */
export const assetAuditSourceSchema = z.enum(["user", "assistant", "system"]);
export type AssetAuditSource = z.infer<typeof assetAuditSourceSchema>;

/**
 * An internal Asset Audit record: what happened, who did it (actor), where the
 * write came from (source), the visibility scope the Asset held at write time, and
 * free-form provenance detail. Append-only.
 */
export const assetAuditEventSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  ownerUserId: z.string(),
  kind: assetAuditEventKindSchema,
  actorUserId: z.string().nullable().default(null),
  source: assetAuditSourceSchema,
  // The Asset's scope when this event was recorded, so audit reads carry the
  // visibility context of the write without a join.
  scope: privacyScopeSchema,
  detailJson: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
});

export const createAssetAuditEventSchema = assetAuditEventSchema.omit({
  id: true,
  createdAt: true,
});

export type AssetAuditEvent = z.infer<typeof assetAuditEventSchema>;
export type CreateAssetAuditEventInput = z.input<typeof createAssetAuditEventSchema>;
