"use server";

import type { AddAssetEvidenceInput } from "@tendnote/db/queries/assets";
import {
  addAssetEvidence,
  addAssetEvidenceToNewAsset,
  listAssetEvidenceCaptureTargets,
  removeAssetEvidence,
} from "@tendnote/db/queries/assets";
import {
  assertAssetEvidenceFileAccepted,
  assetEvidenceKindSchema,
  assetKindSchema,
  assetLabelForKind,
} from "@tendnote/domain";
import { visibilityChoiceSchema, visibilityLabelForScope } from "@tendnote/domain/privacy";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type { EvidenceDestination } from "@/lib/asset-evidence-destination";
import {
  type AssetEvidenceMutationResult,
  type AssetEvidenceView,
  toAssetEvidenceView,
} from "@/lib/asset-evidence-view";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * The shared Asset Evidence Capture server actions (#200): one thin layer over
 * the owner-scoped seam for every capture surface — the Asset Profile drop
 * zone/mobile capture, the review card, and later Eve's chat plus-menu (#201).
 * File bytes arrive as multipart FormData; everything else is plain fields.
 */

// Optional text fields arrive as "" from empty inputs — treat blank as absent.
const blankAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const evidenceFieldsSchema = z.object({
  kind: assetEvidenceKindSchema,
  label: z.preprocess(
    blankAsUndefined,
    z.string({ error: "Name this evidence." }).trim().min(1, "Name this evidence.").max(120),
  ),
  url: z.preprocess(
    blankAsUndefined,
    z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .optional(),
  ),
  capturedText: z.preprocess(blankAsUndefined, z.string().trim().min(1).max(5000).optional()),
  amount: z.preprocess(
    blankAsUndefined,
    z.coerce.number({ error: "Enter the amount as a number." }).nonnegative().optional(),
  ),
  currency: z.preprocess(blankAsUndefined, z.string().trim().length(3).optional()),
  purchasedOn: z.preprocess(blankAsUndefined, z.iso.date().optional()),
  renewsOn: z.preprocess(blankAsUndefined, z.iso.date().optional()),
  visibilityChoice: z.preprocess(blankAsUndefined, visibilityChoiceSchema.optional()),
  /**
   * Whether this capture is the household's rather than the capturer's. Offered
   * only under a household-native Asset; the seam refuses it anywhere else, so
   * the form field chooses and never decides (ADR 0214, #386).
   */
  household: z.preprocess((value) => value === "true", z.boolean()),
  selectedUserIds: z.array(z.string().min(1)).max(50).optional(),
});

const targetSchema = z.union([
  z.object({ assetId: z.uuid() }),
  z.object({ reviewGroupId: z.uuid() }),
]);

/** Reads the optional upload out of the form, vetting it before bytes are kept. */
async function readUploadedFile(formData: FormData): Promise<AddAssetEvidenceInput["file"]> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return undefined;
  }
  // Vet metadata first so an oversized or off-type file is refused before its
  // bytes are pulled out of the request.
  assertAssetEvidenceFileAccepted({ mimeType: file.type, sizeBytes: file.size });
  return {
    fileName: file.name || "capture",
    mimeType: file.type,
    sizeBytes: file.size,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

/**
 * Maps parsed fields + upload into the evidence part of a capture input — shared
 * by the existing-target and new-asset arms so the field mapping never forks.
 */
function toEvidenceFields(
  fields: z.infer<typeof evidenceFieldsSchema>,
  file: AddAssetEvidenceInput["file"],
  resolvedScope?: { scope: AddAssetEvidenceInput["scope"] } | null,
): Omit<AddAssetEvidenceInput, "ownerUserId" | "assetId" | "reviewGroupId"> {
  return {
    kind: fields.kind,
    label: fields.label,
    file,
    url: fields.url ?? null,
    capturedText: fields.capturedText ?? null,
    money: toEvidenceMoney(fields),
    purchasedOn: fields.purchasedOn ?? null,
    renewsOn: fields.renewsOn ?? null,
    ...(fields.household ? { ownership: "household_native" as const } : {}),
    // Absent lets the seam inherit the anchor. Every explicit choice is re-checked
    // against the authoritative parent Asset in the owner-scoped seam.
    ...toResolvedEvidenceVisibility(fields, resolvedScope),
  };
}

function toResolvedEvidenceVisibility(
  fields: z.infer<typeof evidenceFieldsSchema>,
  resolvedScope?: { scope: AddAssetEvidenceInput["scope"] } | null,
): Partial<Pick<AddAssetEvidenceInput, "scope" | "selectedUserIds">> {
  if (!resolvedScope) return {};
  if (!fields.selectedUserIds?.length) return { scope: resolvedScope.scope };
  return { scope: resolvedScope.scope, selectedUserIds: fields.selectedUserIds };
}

function toEvidenceMoney(
  fields: z.infer<typeof evidenceFieldsSchema>,
): AddAssetEvidenceInput["money"] {
  if (fields.amount === undefined) return null;
  return { amount: fields.amount, currency: (fields.currency ?? "USD").toUpperCase() };
}

/** Maps parsed fields + upload into the seam's capture input. */
function toCaptureInput(
  ownerUserId: string,
  target: z.infer<typeof targetSchema>,
  fields: z.infer<typeof evidenceFieldsSchema>,
  file: AddAssetEvidenceInput["file"],
  resolvedScope: { scope: AddAssetEvidenceInput["scope"] } | null,
): AddAssetEvidenceInput {
  return { ownerUserId, ...target, ...toEvidenceFields(fields, file, resolvedScope) };
}

const evidenceActionSchema = z.instanceof(FormData).transform((formData) => ({
  formData,
  target: targetSchema.parse(
    formData.get("reviewGroupId")
      ? { reviewGroupId: formData.get("reviewGroupId") }
      : { assetId: formData.get("assetId") },
  ),
  fields: evidenceFieldsSchema.parse({
    ...Object.fromEntries(formData.entries()),
    selectedUserIds: formData.getAll("selectedUserIds").map(String),
  }),
}));

/**
 * Captures one piece of Asset Evidence from multipart form data, attached to an
 * existing Asset (`assetId`) or a still-open Asset Review Group
 * (`reviewGroupId`). Returns the created evidence view, or an inline-safe
 * validation message.
 */
export async function addAssetEvidenceAction(
  formData: FormData,
): Promise<AssetEvidenceMutationResult> {
  return runOwnerAction({
    schema: evidenceActionSchema,
    input: formData,
    visibilityChoice: (parsed) => parsed.fields.visibilityChoice,
    body: async ({ ownerUserId, input: parsed, resolvedScope }) => {
      const file = await readUploadedFile(parsed.formData);
      return addAssetEvidence(
        toCaptureInput(ownerUserId, parsed.target, parsed.fields, file, resolvedScope),
      );
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) =>
      toAssetEvidenceView(outcome.result, { callerUserId: ownerUserId }),
  });
}

// The chat capture's new-asset arm names the thing being proposed; `kind` and
// `label` stay the evidence's own fields, so these carry an `asset` prefix.
const newAssetSchema = z.object({
  assetName: z.string({ error: "Name the asset." }).trim().min(1, "Name the asset.").max(200),
  assetKind: assetKindSchema,
});

export type AssetEvidenceToNewAssetResult =
  | { ok: true; view: { evidence: AssetEvidenceView; assetName: string } }
  | { ok: false; error: string };

/**
 * Captures one piece of Asset Evidence to a brand-new destination (#201): a
 * review-gated Suggested Asset named by the user, opened with the capture riding
 * its Asset Review Group. Nothing becomes durable until the queue accepts it.
 */
export async function addAssetEvidenceToNewAssetAction(
  formData: FormData,
): Promise<AssetEvidenceToNewAssetResult> {
  return runOwnerAction({
    schema: z.instanceof(FormData),
    input: formData,
    body: async ({ ownerUserId, input: parsedFormData }) => {
      const asset = newAssetSchema.parse({
        assetName: parsedFormData.get("assetName"),
        assetKind: parsedFormData.get("assetKind"),
      });
      const fields = evidenceFieldsSchema.parse({
        ...Object.fromEntries(parsedFormData.entries()),
        selectedUserIds: parsedFormData.getAll("selectedUserIds").map(String),
      });
      const file = await readUploadedFile(parsedFormData);
      // A brand-new proposal is private until acceptance widens it, so the
      // keep-private narrowing has nothing to narrow — the scope choice drops.
      const {
        scope: _scope,
        selectedUserIds: _selectedUserIds,
        ...evidenceFields
      } = toEvidenceFields(fields, file);
      return addAssetEvidenceToNewAsset({
        ownerUserId,
        asset: { name: asset.assetName, kind: asset.assetKind },
        ...evidenceFields,
      });
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => {
      const { evidence, group } = outcome.result;
      return {
        evidence: toAssetEvidenceView(evidence, { callerUserId: ownerUserId }),
        assetName: group.asset.name,
      };
    },
  });
}

/**
 * The chat capture's destination candidates (#201), mapped to serializable
 * views. The owner/active/open rule lives in the owner-scoped seam
 * (`listAssetEvidenceCaptureTargets`), not here; every write re-resolves
 * authoritative records through the seam.
 */
export async function listAssetEvidenceDestinationsAction(): Promise<EvidenceDestination[]> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const targets = await listAssetEvidenceCaptureTargets({ ownerUserId });

  const assetDestinations: EvidenceDestination[] = targets.assets.map((asset) => ({
    targetKind: "asset",
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    kindLabel: assetLabelForKind(asset.kind),
    scope: asset.scope,
    visibilityLabel: visibilityLabelForScope(asset.scope),
  }));

  const reviewDestinations: EvidenceDestination[] = targets.reviews.map(({ groupId, asset }) => ({
    targetKind: "review",
    groupId,
    assetName: asset.name,
    kind: asset.kind,
    kindLabel: assetLabelForKind(asset.kind),
    scope: asset.scope,
  }));

  return [...assetDestinations, ...reviewDestinations];
}

/** Removes one piece of evidence — the row and its bytes. Owner-only downstream. */
export async function removeAssetEvidenceAction(input: {
  evidenceId: string;
}): Promise<{ ok: true; view: { evidenceId: string } } | { ok: false; error: string }> {
  return runOwnerAction({
    schema: z.object({ evidenceId: z.uuid() }),
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const outcome = await removeAssetEvidence({
        actorUserId: ownerUserId,
        evidenceId: parsed.evidenceId,
      });
      return { ...outcome, evidenceId: parsed.evidenceId };
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ evidenceId: outcome.evidenceId }),
  });
}
