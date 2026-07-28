"use server";

import {
  archiveGeneralActionArea,
  createGeneralActionArea,
  renameGeneralActionArea,
  unarchiveGeneralActionArea,
} from "@tendnote/db/queries/general-action-areas";
import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { generalActionAreaNameSchema } from "@tendnote/domain";
import { z } from "zod";
import {
  type GeneralActionAreaMutationResult,
  toGeneralActionAreaView,
} from "@/lib/general-action-area-view";
import { runOwnerAction } from "@/lib/owner-action";

const areaIdSchema = z.object({ areaId: z.uuid() });
const areaNameInputSchema = z.object({ name: generalActionAreaNameSchema });
const renameAreaInputSchema = areaIdSchema.extend({ name: generalActionAreaNameSchema });
const affectedActionScopes = (_area: unknown, ownerUserId: string): AffectedScope[] => [
  {
    kind: "viewer-collection",
    collection: "general-actions",
    viewerUserId: ownerUserId,
  },
];

export async function createGeneralActionAreaAction(input: {
  name: string;
}): Promise<GeneralActionAreaMutationResult> {
  return runOwnerAction({
    schema: areaNameInputSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      createGeneralActionArea({ ownerUserId, name: parsed.name }),
    affectedScopes: affectedActionScopes,
    result: toGeneralActionAreaView,
  });
}

export async function renameGeneralActionAreaAction(input: {
  areaId: string;
  name: string;
}): Promise<GeneralActionAreaMutationResult> {
  return runOwnerAction({
    schema: renameAreaInputSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      renameGeneralActionArea({
        ownerUserId,
        areaId: parsed.areaId,
        name: parsed.name,
      }),
    affectedScopes: affectedActionScopes,
    result: toGeneralActionAreaView,
  });
}

export async function archiveGeneralActionAreaAction(input: {
  areaId: string;
}): Promise<GeneralActionAreaMutationResult> {
  return runOwnerAction({
    schema: areaIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      archiveGeneralActionArea({ ownerUserId, areaId: parsed.areaId }),
    affectedScopes: affectedActionScopes,
    result: toGeneralActionAreaView,
  });
}

export async function unarchiveGeneralActionAreaAction(input: {
  areaId: string;
}): Promise<GeneralActionAreaMutationResult> {
  return runOwnerAction({
    schema: areaIdSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      unarchiveGeneralActionArea({ ownerUserId, areaId: parsed.areaId }),
    affectedScopes: affectedActionScopes,
    result: toGeneralActionAreaView,
  });
}
