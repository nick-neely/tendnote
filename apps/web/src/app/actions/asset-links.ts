"use server";

import {
  acceptSuggestedAssetLink,
  addAssetLink,
  addAssetPersonLink,
  dismissSuggestedAssetLink,
  removeAssetLink,
  removeAssetPersonLink,
} from "@tendnote/db/queries/assets";
import { assetLinkRelationSchema, assetPersonRelationSchema } from "@tendnote/domain";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type { AssetLinkMutationResult } from "@/lib/asset-link-view";
import { runAssetsMutation } from "@/lib/asset-mutation";

/**
 * Server actions for the Asset Profile's lightweight links (#202): Related
 * Asset Links (explicit adds are active immediately; the review pair resolves
 * inferred suggestions) and Asset Person Links. Thin over the owner-scoped link
 * seam — validation, scope rules, and audit all live there.
 */

const addAssetLinkSchema = z.object({
  fromAssetId: z.uuid(),
  toAssetId: z.uuid(),
  relation: assetLinkRelationSchema,
});

const linkIdSchema = z.object({ linkId: z.uuid() });

const addAssetPersonLinkSchema = z.object({
  assetId: z.uuid(),
  personId: z.uuid(),
  relation: assetPersonRelationSchema,
});

/** Runs a link mutation; success carries no view — the profile re-renders. */
function runLinkMutation(run: () => Promise<unknown>): Promise<AssetLinkMutationResult> {
  return runAssetsMutation(run, () => null);
}

/** Links two assets from explicit intent — active immediately, no review gate. */
export async function addAssetLinkAction(input: {
  fromAssetId: string;
  toAssetId: string;
  relation: string;
}): Promise<AssetLinkMutationResult> {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runLinkMutation(() => {
    const parsed = addAssetLinkSchema.parse(input);
    return addAssetLink({ actorUserId, ...parsed });
  });
}

/** Accepts a pending inferred link — the review gate opening on explicit intent. */
export async function acceptSuggestedAssetLinkAction(input: {
  linkId: string;
}): Promise<AssetLinkMutationResult> {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runLinkMutation(() => {
    const parsed = linkIdSchema.parse(input);
    return acceptSuggestedAssetLink({ actorUserId, linkId: parsed.linkId });
  });
}

/** Sets a pending inferred link aside — remembered, never re-proposed. */
export async function dismissSuggestedAssetLinkAction(input: {
  linkId: string;
}): Promise<AssetLinkMutationResult> {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runLinkMutation(() => {
    const parsed = linkIdSchema.parse(input);
    return dismissSuggestedAssetLink({ actorUserId, linkId: parsed.linkId });
  });
}

/** Removes the caller's own Related Asset Link. */
export async function removeAssetLinkAction(input: {
  linkId: string;
}): Promise<AssetLinkMutationResult> {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runLinkMutation(() => {
    const parsed = linkIdSchema.parse(input);
    return removeAssetLink({ actorUserId, linkId: parsed.linkId });
  });
}

/** Links one of the caller's own people to an asset as context. */
export async function addAssetPersonLinkAction(input: {
  assetId: string;
  personId: string;
  relation: string;
}): Promise<AssetLinkMutationResult> {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runLinkMutation(() => {
    const parsed = addAssetPersonLinkSchema.parse(input);
    return addAssetPersonLink({ actorUserId, ...parsed });
  });
}

/** Removes the caller's own Asset Person Link. */
export async function removeAssetPersonLinkAction(input: {
  linkId: string;
}): Promise<AssetLinkMutationResult> {
  const actorUserId = await requireAdmittedOwnerForAction();
  return runLinkMutation(() => {
    const parsed = linkIdSchema.parse(input);
    return removeAssetPersonLink({ actorUserId, linkId: parsed.linkId });
  });
}
