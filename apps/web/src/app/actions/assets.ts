"use server";

import { searchAssets } from "@tendnote/db/queries/asset-search";
import {
  archiveAsset,
  browseAssets,
  createAsset,
  editAsset,
  hardDeleteAsset,
  restoreAsset,
} from "@tendnote/db/queries/assets";
import { assetKindSchema } from "@tendnote/domain";
import { visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { type AssetSearchResultView, toAssetSearchResultView } from "@/lib/asset-search-view";
import {
  type AssetBrowsePageView,
  type AssetBrowseRequest,
  type AssetMutationResult,
  toAssetBrowseView,
  toAssetView,
} from "@/lib/asset-view";
import { runOwnerAction } from "@/lib/owner-action";

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
export async function createAssetAction(input: {
  name: string;
  kind: string;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<AssetMutationResult> {
  return runOwnerAction({
    schema: createAssetActionSchema,
    input,
    visibilityChoice: (parsed) => parsed.visibilityChoice,
    body: ({ ownerUserId, input: parsed, resolvedScope }) =>
      createAsset({
        ownerUserId,
        name: parsed.name,
        kind: parsed.kind,
        scope: resolvedScope?.scope,
        householdId: resolvedScope?.householdId,
        selectedUserIds: parsed.selectedUserIds,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAssetView(outcome.result, { callerUserId }),
  });
}

/** Edits an Asset's name and/or kind. Owner-only and active-only downstream. */
export async function editAssetAction(input: {
  assetId: string;
  name?: string;
  kind?: string;
}): Promise<AssetMutationResult> {
  return runOwnerAction({
    schema: editAssetActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editAsset({
        actorUserId: ownerUserId,
        assetId: parsed.assetId,
        edit: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
        },
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAssetView(outcome.result, { callerUserId }),
  });
}

/** Archives an Asset — the normal inactive path; history stays intact. */
export async function archiveAssetAction(input: { assetId: string }): Promise<AssetMutationResult> {
  return runOwnerAction({
    schema: assetIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      archiveAsset({ actorUserId: ownerUserId, assetId: parsed.assetId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAssetView(outcome.result, { callerUserId }),
  });
}

/** Restores an archived Asset back to active. */
export async function restoreAssetAction(input: { assetId: string }): Promise<AssetMutationResult> {
  return runOwnerAction({
    schema: assetIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      restoreAsset({ actorUserId: ownerUserId, assetId: parsed.assetId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, callerUserId) => toAssetView(outcome.result, { callerUserId }),
  });
}

/** Human-only correction/privacy delete; intentionally not exposed as an Eve tool. */
export async function hardDeleteAssetAction(input: { assetId: string }) {
  return runOwnerAction({
    schema: assetIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      hardDeleteAsset({ actorUserId: ownerUserId, assetId: parsed.assetId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => undefined,
  });
}

const searchAssetsActionSchema = z.object({
  query: z.string().trim().min(1).max(400),
  includeArchived: z.boolean().default(false),
});

const browseAssetsActionSchema = z.object({
  kind: assetKindSchema.nullable(),
  state: z.enum(["active", "archived", "all"]),
  scope: z.enum(["private", "shared", "household"]).nullable(),
  due: z.enum(["with_due_action", "without_due_action"]).nullable(),
  review: z.enum(["needs_review", "ready"]).nullable(),
  sort: z.enum(["name", "due_action", "needs_review", "recently_added"]),
  offset: z.number().int().min(0).optional(),
});

/** Server-backed Assets ledger page; every filter and sort stays truthful past page one. */
export async function browseAssetsAction(input: AssetBrowseRequest): Promise<AssetBrowsePageView> {
  const callerUserId = await requireAdmittedOwnerForAction();
  const parsed = browseAssetsActionSchema.parse(input);
  const page = await browseAssets({
    callerUserId,
    kinds: parsed.kind ? [parsed.kind] : undefined,
    statuses: parsed.state === "all" ? undefined : [parsed.state],
    scopes: parsed.scope ? [parsed.scope] : undefined,
    due: parsed.due ?? undefined,
    review: parsed.review ?? undefined,
    sort: parsed.sort,
    offset: parsed.offset,
  });
  const now = new Date();
  return {
    assets: page.items.map((item) => toAssetBrowseView(item, { callerUserId, now })),
    reviewCount: page.reviewCount,
    nextOffset: page.nextOffset,
  };
}

/**
 * Unified Asset Search for the Assets surface (#204). One query runs exact text, exact
 * structured values, and fuzzy intent together — the user never picks a mode.
 *
 * A thin caller over the shared owner-scoped seam: visibility filtering, the review
 * gate, and ranking all live there, so this surface cannot widen what it may see. An
 * empty or over-long query is simply no results rather than an error — a search box is
 * not a place to throw.
 */
export async function searchAssetsAction(input: {
  query: string;
  includeArchived?: boolean;
}): Promise<{ results: AssetSearchResultView[] }> {
  const callerUserId = await requireAdmittedOwnerForAction();
  const parsed = searchAssetsActionSchema.safeParse(input);
  if (!parsed.success) {
    return { results: [] };
  }

  const results = await searchAssets({
    ownerUserId: callerUserId,
    query: parsed.data.query,
    includeArchived: parsed.data.includeArchived,
    limit: 20,
  });

  return {
    results: results
      .map(toAssetSearchResultView)
      .filter((result): result is AssetSearchResultView => result !== null),
  };
}
