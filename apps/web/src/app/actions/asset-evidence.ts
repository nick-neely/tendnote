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
import {
  scopeForVisibilityChoice,
  visibilityChoiceSchema,
  visibilityLabelForScope,
} from "@tendnote/domain/privacy";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type { EvidenceDestination } from "@/lib/asset-evidence-destination";
import {
  type AssetEvidenceMutationResult,
  type AssetEvidenceView,
  toAssetEvidenceView,
} from "@/lib/asset-evidence-view";
import { runAssetsMutation } from "@/lib/asset-mutation";
import { assetMutationScopes, updateAssetMutationScopes } from "@/lib/cache/asset-mutation-scopes";

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
    // Absent lets the seam inherit the anchor. Every explicit choice is re-checked
    // against the authoritative parent Asset in the owner-scoped seam.
    ...toEvidenceVisibility(fields),
  };
}

function toEvidenceMoney(
  fields: z.infer<typeof evidenceFieldsSchema>,
): AddAssetEvidenceInput["money"] {
  if (fields.amount === undefined) return null;
  return { amount: fields.amount, currency: (fields.currency ?? "USD").toUpperCase() };
}

function toEvidenceVisibility(
  fields: z.infer<typeof evidenceFieldsSchema>,
): Partial<Pick<AddAssetEvidenceInput, "scope" | "selectedUserIds">> {
  if (!fields.visibilityChoice) return {};
  const scope = scopeForVisibilityChoice(fields.visibilityChoice);
  if (!fields.selectedUserIds?.length) return { scope };
  return { scope, selectedUserIds: fields.selectedUserIds };
}

/** Maps parsed fields + upload into the seam's capture input. */
function toCaptureInput(
  ownerUserId: string,
  target: z.infer<typeof targetSchema>,
  fields: z.infer<typeof evidenceFieldsSchema>,
  file: AddAssetEvidenceInput["file"],
): AddAssetEvidenceInput {
  return { ownerUserId, ...target, ...toEvidenceFields(fields, file) };
}

/**
 * Captures one piece of Asset Evidence from multipart form data, attached to an
 * existing Asset (`assetId`) or a still-open Asset Review Group
 * (`reviewGroupId`). Returns the created evidence view, or an inline-safe
 * validation message.
 */
export async function addAssetEvidenceAction(
  formData: FormData,
): Promise<AssetEvidenceMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runAssetsMutation(
    async () => {
      const target = targetSchema.parse(
        formData.get("reviewGroupId")
          ? { reviewGroupId: formData.get("reviewGroupId") }
          : { assetId: formData.get("assetId") },
      );
      const fields = evidenceFieldsSchema.parse({
        ...Object.fromEntries(formData.entries()),
        selectedUserIds: formData.getAll("selectedUserIds").map(String),
      });
      const file = await readUploadedFile(formData);
      return addAssetEvidence(toCaptureInput(ownerUserId, target, fields, file));
    },
    (evidence) => {
      updateAssetMutationScopes(
        assetMutationScopes.forAssetIds({
          callerUserId: ownerUserId,
          assetIds: [evidence.assetId],
        }),
      );
      return toAssetEvidenceView(evidence, { callerUserId: ownerUserId });
    },
  );
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
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runAssetsMutation(
    async () => {
      const asset = newAssetSchema.parse({
        assetName: formData.get("assetName"),
        assetKind: formData.get("assetKind"),
      });
      const fields = evidenceFieldsSchema.parse({
        ...Object.fromEntries(formData.entries()),
        selectedUserIds: formData.getAll("selectedUserIds").map(String),
      });
      const file = await readUploadedFile(formData);
      // A brand-new proposal is private until acceptance widens it, so the
      // keep-private narrowing has nothing to narrow — the scope choice drops.
      const {
        scope: _scope,
        selectedUserIds: _selectedUserIds,
        ...evidenceFields
      } = toEvidenceFields(fields, file);
      const result = await addAssetEvidenceToNewAsset({
        ownerUserId,
        asset: { name: asset.assetName, kind: asset.assetKind },
        ...evidenceFields,
      });
      return result;
    },
    ({ evidence, group }) => {
      updateAssetMutationScopes(
        assetMutationScopes.forAssetIds({
          callerUserId: ownerUserId,
          assetIds: [evidence.assetId, group.asset.id],
        }),
      );
      return {
        evidence: toAssetEvidenceView(evidence, { callerUserId: ownerUserId }),
        assetName: group.asset.name,
      };
    },
  );
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
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runAssetsMutation(
    async () => {
      const parsed = z.object({ evidenceId: z.uuid() }).parse(input);
      const evidence = await removeAssetEvidence({
        actorUserId: ownerUserId,
        evidenceId: parsed.evidenceId,
      });
      return { evidenceId: parsed.evidenceId, assetId: evidence.assetId };
    },
    (parsed) => {
      updateAssetMutationScopes(
        assetMutationScopes.forAssetIds({ callerUserId: ownerUserId, assetIds: [parsed.assetId] }),
      );
      return { evidenceId: parsed.evidenceId };
    },
  );
}
