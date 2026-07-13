"use server";

import type { AddAssetEvidenceInput } from "@tendnote/db/queries/assets";
import { addAssetEvidence, removeAssetEvidence } from "@tendnote/db/queries/assets";
import { assertAssetEvidenceFileAccepted, assetEvidenceKindSchema } from "@tendnote/domain";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { type AssetEvidenceMutationResult, toAssetEvidenceView } from "@/lib/asset-evidence-view";
import { runAssetsMutation } from "@/lib/asset-mutation";

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
  // "Keep this just for me" under a household asset.
  keepPrivate: z.preprocess(blankAsUndefined, z.enum(["true", "false"]).optional()),
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

/** Maps parsed fields + upload into the seam's capture input. */
function toCaptureInput(
  ownerUserId: string,
  target: z.infer<typeof targetSchema>,
  fields: z.infer<typeof evidenceFieldsSchema>,
  file: AddAssetEvidenceInput["file"],
): AddAssetEvidenceInput {
  return {
    ownerUserId,
    ...target,
    kind: fields.kind,
    label: fields.label,
    file,
    url: fields.url ?? null,
    capturedText: fields.capturedText ?? null,
    money:
      fields.amount !== undefined
        ? { amount: fields.amount, currency: (fields.currency ?? "USD").toUpperCase() }
        : null,
    purchasedOn: fields.purchasedOn ?? null,
    renewsOn: fields.renewsOn ?? null,
    // Absent lets the seam default to the anchor's scope; the explicit choice
    // narrows to private. Widening beyond the anchor is impossible either way.
    ...(fields.keepPrivate === "true" ? { scope: "private" as const } : {}),
  };
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
      const fields = evidenceFieldsSchema.parse(Object.fromEntries(formData.entries()));
      const file = await readUploadedFile(formData);
      return addAssetEvidence(toCaptureInput(ownerUserId, target, fields, file));
    },
    (evidence) => toAssetEvidenceView(evidence, { callerUserId: ownerUserId }),
  );
}

/** Removes one piece of evidence — the row and its bytes. Owner-only downstream. */
export async function removeAssetEvidenceAction(input: {
  evidenceId: string;
}): Promise<{ ok: true; view: { evidenceId: string } } | { ok: false; error: string }> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runAssetsMutation(
    async () => {
      const parsed = z.object({ evidenceId: z.uuid() }).parse(input);
      await removeAssetEvidence({ actorUserId: ownerUserId, evidenceId: parsed.evidenceId });
      return parsed;
    },
    (parsed) => ({ evidenceId: parsed.evidenceId }),
  );
}
