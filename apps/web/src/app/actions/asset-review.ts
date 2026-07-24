"use server";

import type { AssetReviewGroupResult } from "@tendnote/db/queries/assets";
import {
  acceptAssetReviewGroup,
  acceptSuggestedAsset,
  acceptSuggestedAssetMemory,
  dismissAssetReviewGroup,
  dismissSuggestedAssetMemory,
  editSuggestedAsset,
  editSuggestedAssetMemory,
  linkAssetReviewGroup,
} from "@tendnote/db/queries/assets";
import type { AssetEdit, AssetMemoryEdit } from "@tendnote/domain";
import { assetEditSchema, assetMemoryEditSchema } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { toAssetReviewGroupViewWithOrigin } from "@/lib/asset-review-origin";
import type { AssetReviewGroupView } from "@/lib/asset-review-view";
import { invalidateReviewOwner } from "@/lib/cache/today-review-mutation-scopes";

const groupIdSchema = z.object({ groupId: z.uuid() });
const assetIdSchema = z.object({ assetId: z.uuid() });
const memoryIdSchema = z.object({ memoryId: z.uuid() });

// Edit-before-accept payloads are the domain's own edit schemas — no local
// re-declaration to drift; the review layer re-validates against the record.

/**
 * Every mutation ends here: re-render the surfaces that show review state so
 * they all agree, then map the result to the serializable card view (with its
 * promoted-from action origin, #199). Named for both effects — this is
 * deliberately not a pure mapper.
 */
function revalidateAndView(
  ownerUserId: string,
  result: AssetReviewGroupResult,
): Promise<AssetReviewGroupView> {
  invalidateReviewOwner(ownerUserId);
  revalidatePath("/assets");
  return toAssetReviewGroupViewWithOrigin(result);
}

export async function acceptSuggestedAssetAction(input: {
  assetId: string;
  edit?: AssetEdit;
}): Promise<AssetReviewGroupView> {
  const { assetId } = assetIdSchema.parse({ assetId: input.assetId });
  const edit = assetEditSchema.parse(input.edit ?? {});
  const ownerUserId = await requireAdmittedOwnerForAction();
  return revalidateAndView(
    ownerUserId,
    await acceptSuggestedAsset({ actorUserId: ownerUserId, assetId, edit }),
  );
}

export async function editSuggestedAssetAction(input: {
  assetId: string;
  edit: AssetEdit;
}): Promise<AssetReviewGroupView> {
  const { assetId } = assetIdSchema.parse({ assetId: input.assetId });
  const edit = assetEditSchema.parse(input.edit);
  const ownerUserId = await requireAdmittedOwnerForAction();
  return revalidateAndView(
    ownerUserId,
    await editSuggestedAsset({ actorUserId: ownerUserId, assetId, edit }),
  );
}

export async function acceptSuggestedAssetMemoryAction(input: {
  memoryId: string;
  edit?: AssetMemoryEdit;
}): Promise<AssetReviewGroupView> {
  const { memoryId } = memoryIdSchema.parse({ memoryId: input.memoryId });
  const edit = assetMemoryEditSchema.parse(input.edit ?? {});
  const ownerUserId = await requireAdmittedOwnerForAction();
  return revalidateAndView(
    ownerUserId,
    await acceptSuggestedAssetMemory({ actorUserId: ownerUserId, memoryId, edit }),
  );
}

export async function editSuggestedAssetMemoryAction(input: {
  memoryId: string;
  edit: AssetMemoryEdit;
}): Promise<AssetReviewGroupView> {
  const { memoryId } = memoryIdSchema.parse({ memoryId: input.memoryId });
  const edit = assetMemoryEditSchema.parse(input.edit);
  const ownerUserId = await requireAdmittedOwnerForAction();
  return revalidateAndView(
    ownerUserId,
    await editSuggestedAssetMemory({ actorUserId: ownerUserId, memoryId, edit }),
  );
}

export async function dismissSuggestedAssetMemoryAction(input: {
  memoryId: string;
}): Promise<AssetReviewGroupView> {
  const { memoryId } = memoryIdSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  return revalidateAndView(
    ownerUserId,
    await dismissSuggestedAssetMemory({ actorUserId: ownerUserId, memoryId }),
  );
}

export async function acceptAssetReviewGroupAction(input: {
  groupId: string;
}): Promise<AssetReviewGroupView> {
  const { groupId } = groupIdSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  return revalidateAndView(
    ownerUserId,
    await acceptAssetReviewGroup({ actorUserId: ownerUserId, groupId }),
  );
}

export async function dismissAssetReviewGroupAction(input: {
  groupId: string;
}): Promise<AssetReviewGroupView> {
  const { groupId } = groupIdSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  return revalidateAndView(
    ownerUserId,
    await dismissAssetReviewGroup({ actorUserId: ownerUserId, groupId }),
  );
}

export async function linkAssetReviewGroupAction(input: {
  groupId: string;
  targetAssetId: string;
}): Promise<AssetReviewGroupView> {
  const parsed = z.object({ groupId: z.uuid(), targetAssetId: z.uuid() }).parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  return revalidateAndView(
    ownerUserId,
    await linkAssetReviewGroup({
      actorUserId: ownerUserId,
      groupId: parsed.groupId,
      targetAssetId: parsed.targetAssetId,
    }),
  );
}
