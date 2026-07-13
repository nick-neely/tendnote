"use server";

import type { AssetWithContext } from "@tendnote/db/queries/assets";
import { archiveAsset, createAsset, editAsset, restoreAsset } from "@tendnote/db/queries/assets";
import { assetKindSchema } from "@tendnote/domain";
import { visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { runAssetsMutation } from "@/lib/asset-mutation";
import { type AssetMutationResult, toAssetView } from "@/lib/asset-view";
import { resolveScopeForCaller } from "@/lib/resolve-scope-for-caller";

const assetIdSchema = z.object({ assetId: z.uuid() });

const nameSchema = z.string().trim().min(1, "Name the asset.").max(200);
// Bounded so a share request can't smuggle an unbounded id list; a household is small.
const selectedUserIdsSchema = z.array(z.string().min(1)).max(50).optional();

const createAssetActionSchema = z.object({
  name: nameSchema,
  kind: assetKindSchema,
  // Visibility choice → scope; households resolve downstream (ADR 0153).
  visibilityChoice: visibilityChoiceSchema.default("only_me"),
  selectedUserIds: selectedUserIdsSchema,
});

const editAssetActionSchema = z.object({
  assetId: z.uuid(),
  name: nameSchema.optional(),
  kind: assetKindSchema.optional(),
});

/**
 * Runs an Asset mutation and maps the result to a view for the acting caller, so
 * `owned` reflects whoever is viewing.
 */
function runMutation(
  callerUserId: string,
  run: () => Promise<AssetWithContext>,
): Promise<AssetMutationResult> {
  return runAssetsMutation(run, (asset) => toAssetView(asset, { callerUserId }));
}

export async function createAssetAction(input: {
  name: string;
  kind: string;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<AssetMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, async () => {
    const parsed = createAssetActionSchema.parse(input);
    const { scope, householdId } = await resolveScopeForCaller(
      ownerUserId,
      parsed.visibilityChoice,
    );
    return createAsset({
      ownerUserId,
      name: parsed.name,
      kind: parsed.kind,
      scope,
      householdId,
      selectedUserIds: parsed.selectedUserIds,
    });
  });
}

/** Edits an Asset's name and/or kind. Owner-only and active-only downstream. */
export async function editAssetAction(input: {
  assetId: string;
  name?: string;
  kind?: string;
}): Promise<AssetMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, async () => {
    const parsed = editAssetActionSchema.parse(input);
    return editAsset({
      actorUserId: ownerUserId,
      assetId: parsed.assetId,
      edit: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
      },
    });
  });
}

/** Archives an Asset — the normal inactive path; history stays intact. */
export async function archiveAssetAction(input: { assetId: string }): Promise<AssetMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, () => {
    const parsed = assetIdSchema.parse(input);
    return archiveAsset({ actorUserId: ownerUserId, assetId: parsed.assetId });
  });
}

/** Restores an archived Asset back to active. */
export async function restoreAssetAction(input: { assetId: string }): Promise<AssetMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return runMutation(ownerUserId, () => {
    const parsed = assetIdSchema.parse(input);
    return restoreAsset({ actorUserId: ownerUserId, assetId: parsed.assetId });
  });
}
