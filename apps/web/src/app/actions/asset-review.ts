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
import { z } from "zod";
import { toAssetReviewGroupViewWithOrigin } from "@/lib/asset-review-origin";
import { runOwnerAction } from "@/lib/owner-action";

const groupIdSchema = z.object({ groupId: z.uuid() });
const memoryIdSchema = z.object({ memoryId: z.uuid() });
const acceptAssetSchema = z.object({ assetId: z.uuid(), edit: assetEditSchema.optional() });
const editAssetSchema = z.object({ assetId: z.uuid(), edit: assetEditSchema });
const acceptMemorySchema = z.object({ memoryId: z.uuid(), edit: assetMemoryEditSchema.optional() });
const editMemorySchema = z.object({ memoryId: z.uuid(), edit: assetMemoryEditSchema });
const linkGroupSchema = z.object({ groupId: z.uuid(), targetAssetId: z.uuid() });

// Edit-before-accept payloads are the domain's own edit schemas — no local
// re-declaration to drift; the review layer re-validates against the record.

/**
 * Every mutation ends here: re-render the surfaces that show review state so
 * they all agree, then map the result to the serializable card view (with its
 * promoted-from action origin, #199). Named for both effects — this is
 * deliberately not a pure mapper.
 */
function runReviewAction<TInput>(
  schema: { parse(input: unknown): TInput },
  input: unknown,
  mutate: (
    ownerUserId: string,
    parsed: TInput,
  ) => Promise<{
    result: AssetReviewGroupResult;
    affectedScopes: import("@tendnote/db/queries/general-actions").AffectedScope[];
  }>,
) {
  return runOwnerAction({
    schema,
    input,
    body: ({ ownerUserId, input: parsed }) => mutate(ownerUserId, parsed),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toAssetReviewGroupViewWithOrigin(outcome.result),
  });
}

export async function acceptSuggestedAssetAction(input: { assetId: string; edit?: AssetEdit }) {
  return runReviewAction(acceptAssetSchema, input, (ownerUserId, parsed) =>
    acceptSuggestedAsset({
      actorUserId: ownerUserId,
      assetId: parsed.assetId,
      edit: parsed.edit ?? {},
    }),
  );
}

export async function editSuggestedAssetAction(input: { assetId: string; edit: AssetEdit }) {
  return runReviewAction(editAssetSchema, input, (ownerUserId, parsed) =>
    editSuggestedAsset({
      actorUserId: ownerUserId,
      assetId: parsed.assetId,
      edit: parsed.edit,
    }),
  );
}

export async function acceptSuggestedAssetMemoryAction(input: {
  memoryId: string;
  edit?: AssetMemoryEdit;
}) {
  return runReviewAction(acceptMemorySchema, input, (ownerUserId, parsed) =>
    acceptSuggestedAssetMemory({
      actorUserId: ownerUserId,
      memoryId: parsed.memoryId,
      edit: parsed.edit ?? {},
    }),
  );
}

export async function editSuggestedAssetMemoryAction(input: {
  memoryId: string;
  edit: AssetMemoryEdit;
}) {
  return runReviewAction(editMemorySchema, input, (ownerUserId, parsed) =>
    editSuggestedAssetMemory({
      actorUserId: ownerUserId,
      memoryId: parsed.memoryId,
      edit: parsed.edit,
    }),
  );
}

export async function dismissSuggestedAssetMemoryAction(input: { memoryId: string }) {
  return runReviewAction(memoryIdSchema, input, (ownerUserId, parsed) =>
    dismissSuggestedAssetMemory({ actorUserId: ownerUserId, memoryId: parsed.memoryId }),
  );
}

export async function acceptAssetReviewGroupAction(input: { groupId: string }) {
  return runReviewAction(groupIdSchema, input, (ownerUserId, parsed) =>
    acceptAssetReviewGroup({ actorUserId: ownerUserId, groupId: parsed.groupId }),
  );
}

export async function dismissAssetReviewGroupAction(input: { groupId: string }) {
  return runReviewAction(groupIdSchema, input, (ownerUserId, parsed) =>
    dismissAssetReviewGroup({ actorUserId: ownerUserId, groupId: parsed.groupId }),
  );
}

export async function linkAssetReviewGroupAction(input: {
  groupId: string;
  targetAssetId: string;
}) {
  return runReviewAction(linkGroupSchema, input, (ownerUserId, parsed) =>
    linkAssetReviewGroup({
      actorUserId: ownerUserId,
      groupId: parsed.groupId,
      targetAssetId: parsed.targetAssetId,
    }),
  );
}
