"use server";

import {
  archiveGeneralAction,
  completeGeneralAction,
  createGeneralAction,
  deferGeneralAction,
  dismissGeneralAction,
  editGeneralAction,
  listGeneralActionHistory,
  reopenGeneralAction,
} from "@tendnote/db/queries/general-actions";
import type { GeneralAction } from "@tendnote/domain";
import { generalActionLinkSchema } from "@tendnote/domain";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { parseDateInputValue } from "@/lib/followup-view";
import { runActionsMutation } from "@/lib/general-action-mutation";
import {
  type GeneralActionEventView,
  type GeneralActionMutationResult,
  toGeneralActionEventView,
  toGeneralActionView,
} from "@/lib/general-action-view";

const actionIdSchema = z.object({ generalActionId: z.uuid() });

// Due dates arrive from a date input as `YYYY-MM-DD`; resolve them to local
// midnight so the chosen day stays stable, mirroring the Follow-Up create path.
const dateInputSchema = z.string().transform(parseDateInputValue);

const linksSchema = z.array(generalActionLinkSchema).max(10);

const createActionSchema = z.object({
  title: z.string().trim().min(1, "Name the action.").max(280),
  notes: z.string().trim().min(1).max(2000).optional(),
  dueAt: dateInputSchema.optional(),
  links: linksSchema.optional(),
  // The primary Area this Action is filed under; verified owner-visible downstream.
  areaId: z.uuid().nullable().optional(),
});

const editActionSchema = z.object({
  generalActionId: z.uuid(),
  title: z.string().trim().min(1).max(280).optional(),
  // `null` clears the field; `undefined` leaves it untouched.
  notes: z.string().trim().min(1).max(2000).nullable().optional(),
  dueAt: dateInputSchema.nullable().optional(),
  links: linksSchema.optional(),
  // `null` unfiles the Action; `undefined` leaves its Area untouched.
  areaId: z.uuid().nullable().optional(),
});

const deferActionSchema = z.object({
  generalActionId: z.uuid(),
  deferUntil: dateInputSchema,
});

/**
 * Runs an Action mutation and maps the result to a view. Thin wrapper over the
 * shared runner so the Action and Area server actions share one result-union path.
 */
function runMutation(
  run: () => Promise<Parameters<typeof toGeneralActionView>[0]>,
): Promise<GeneralActionMutationResult> {
  return runActionsMutation(run, (action) => toGeneralActionView(action));
}

export async function createGeneralActionAction(input: {
  title: string;
  notes?: string;
  dueAt?: string;
  links?: { url: string; label?: string }[];
  areaId?: string | null;
}): Promise<GeneralActionMutationResult> {
  return runMutation(async () => {
    const parsed = createActionSchema.parse(input);
    const ownerUserId = await requireAdmittedOwnerForAction();
    return createGeneralAction({
      ownerUserId,
      title: parsed.title,
      notes: parsed.notes,
      dueAt: parsed.dueAt,
      links: parsed.links,
      areaId: parsed.areaId,
    });
  });
}

export async function editGeneralActionAction(input: {
  generalActionId: string;
  edit: {
    title?: string;
    notes?: string | null;
    dueAt?: string | null;
    links?: { url: string; label?: string }[];
    areaId?: string | null;
  };
}): Promise<GeneralActionMutationResult> {
  return runMutation(async () => {
    const parsed = editActionSchema.parse({
      generalActionId: input.generalActionId,
      ...input.edit,
    });
    const ownerUserId = await requireAdmittedOwnerForAction();
    return editGeneralAction({
      ownerUserId,
      generalActionId: parsed.generalActionId,
      edit: {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
        ...(parsed.dueAt !== undefined ? { dueAt: parsed.dueAt } : {}),
        ...(parsed.links !== undefined ? { links: parsed.links } : {}),
        ...(parsed.areaId !== undefined ? { areaId: parsed.areaId } : {}),
      },
    });
  });
}

function transitionAction(
  generalActionId: string,
  run: (input: { ownerUserId: string; generalActionId: string }) => Promise<GeneralAction>,
): Promise<GeneralActionMutationResult> {
  return runMutation(async () => {
    const parsed = actionIdSchema.parse({ generalActionId });
    const ownerUserId = await requireAdmittedOwnerForAction();
    return run({ ownerUserId, generalActionId: parsed.generalActionId });
  });
}

export async function completeGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, completeGeneralAction);
}

export async function dismissGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, dismissGeneralAction);
}

export async function reopenGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, reopenGeneralAction);
}

export async function archiveGeneralActionAction(input: {
  generalActionId: string;
}): Promise<GeneralActionMutationResult> {
  return transitionAction(input.generalActionId, archiveGeneralAction);
}

export async function deferGeneralActionAction(input: {
  generalActionId: string;
  deferUntil: string;
}): Promise<GeneralActionMutationResult> {
  return runMutation(async () => {
    const parsed = deferActionSchema.parse(input);
    const ownerUserId = await requireAdmittedOwnerForAction();
    return deferGeneralAction({ ownerUserId, ...parsed });
  });
}

export async function listGeneralActionHistoryAction(input: {
  generalActionId: string;
}): Promise<GeneralActionEventView[]> {
  const parsed = actionIdSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const events = await listGeneralActionHistory({
    ownerUserId,
    generalActionId: parsed.generalActionId,
  });

  return events.map((event) => toGeneralActionEventView(event));
}
