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
import type { AssetLinkMutationResult } from "@/lib/asset-link-view";
import { runOwnerAction } from "@/lib/owner-action";

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
function runLinkMutation<TInput>(
  schema: { parse(input: unknown): TInput },
  input: unknown,
  mutate: (
    actorUserId: string,
    parsed: TInput,
  ) => Promise<{
    result: unknown;
    affectedScopes: import("@tendnote/db/queries/general-actions").AffectedScope[];
  }>,
): Promise<AssetLinkMutationResult> {
  return runOwnerAction({
    schema,
    input,
    body: ({ ownerUserId, input: parsed }) => mutate(ownerUserId, parsed),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => null,
  });
}

/** Links two assets from explicit intent — active immediately, no review gate. */
export async function addAssetLinkAction(input: {
  fromAssetId: string;
  toAssetId: string;
  relation: string;
}): Promise<AssetLinkMutationResult> {
  return runLinkMutation(addAssetLinkSchema, input, (actorUserId, parsed) =>
    addAssetLink({ actorUserId, ...parsed }),
  );
}

/** Accepts a pending inferred link — the review gate opening on explicit intent. */
export async function acceptSuggestedAssetLinkAction(input: {
  linkId: string;
}): Promise<AssetLinkMutationResult> {
  return runLinkMutation(linkIdSchema, input, (actorUserId, parsed) =>
    acceptSuggestedAssetLink({ actorUserId, linkId: parsed.linkId }),
  );
}

/** Sets a pending inferred link aside — remembered, never re-proposed. */
export async function dismissSuggestedAssetLinkAction(input: {
  linkId: string;
}): Promise<AssetLinkMutationResult> {
  return runLinkMutation(linkIdSchema, input, (actorUserId, parsed) =>
    dismissSuggestedAssetLink({ actorUserId, linkId: parsed.linkId }),
  );
}

/** Removes the caller's own Related Asset Link. */
export async function removeAssetLinkAction(input: {
  linkId: string;
}): Promise<AssetLinkMutationResult> {
  return runLinkMutation(linkIdSchema, input, (actorUserId, parsed) =>
    removeAssetLink({ actorUserId, linkId: parsed.linkId }),
  );
}

/** Links one of the caller's own people to an asset as context. */
export async function addAssetPersonLinkAction(input: {
  assetId: string;
  personId: string;
  relation: string;
}): Promise<AssetLinkMutationResult> {
  return runLinkMutation(addAssetPersonLinkSchema, input, (actorUserId, parsed) =>
    addAssetPersonLink({ actorUserId, ...parsed }),
  );
}

/** Removes the caller's own Asset Person Link. */
export async function removeAssetPersonLinkAction(input: {
  linkId: string;
}): Promise<AssetLinkMutationResult> {
  return runLinkMutation(linkIdSchema, input, (actorUserId, parsed) =>
    removeAssetPersonLink({ actorUserId, linkId: parsed.linkId }),
  );
}
