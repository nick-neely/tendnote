"use server";

import {
  archiveGeneralActionArea,
  createGeneralActionArea,
  renameGeneralActionArea,
  unarchiveGeneralActionArea,
} from "@tendnote/db/queries/general-action-areas";
import type { GeneralActionArea } from "@tendnote/domain";
import { generalActionAreaNameSchema } from "@tendnote/domain";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import {
  type GeneralActionAreaMutationResult,
  toGeneralActionAreaView,
} from "@/lib/general-action-area-view";
import { runActionsMutation } from "@/lib/general-action-mutation";

const areaIdSchema = z.object({ areaId: z.uuid() });

/** Runs an Area mutation through the shared runner, mapping the result to a view. */
function runMutation(
  run: () => Promise<GeneralActionArea>,
): Promise<GeneralActionAreaMutationResult> {
  return runActionsMutation(run, toGeneralActionAreaView);
}

export async function createGeneralActionAreaAction(input: {
  name: string;
}): Promise<GeneralActionAreaMutationResult> {
  return runMutation(async () => {
    const name = generalActionAreaNameSchema.parse(input.name);
    const ownerUserId = await requireAdmittedOwnerForAction();
    return createGeneralActionArea({ ownerUserId, name });
  });
}

export async function renameGeneralActionAreaAction(input: {
  areaId: string;
  name: string;
}): Promise<GeneralActionAreaMutationResult> {
  return runMutation(async () => {
    const { areaId } = areaIdSchema.parse(input);
    const name = generalActionAreaNameSchema.parse(input.name);
    const ownerUserId = await requireAdmittedOwnerForAction();
    return renameGeneralActionArea({ ownerUserId, areaId, name });
  });
}

export async function archiveGeneralActionAreaAction(input: {
  areaId: string;
}): Promise<GeneralActionAreaMutationResult> {
  return runMutation(async () => {
    const { areaId } = areaIdSchema.parse(input);
    const ownerUserId = await requireAdmittedOwnerForAction();
    return archiveGeneralActionArea({ ownerUserId, areaId });
  });
}

export async function unarchiveGeneralActionAreaAction(input: {
  areaId: string;
}): Promise<GeneralActionAreaMutationResult> {
  return runMutation(async () => {
    const { areaId } = areaIdSchema.parse(input);
    const ownerUserId = await requireAdmittedOwnerForAction();
    return unarchiveGeneralActionArea({ ownerUserId, areaId });
  });
}
