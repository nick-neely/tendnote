"use server";

import {
  captureExplicitSavedItem,
  changeExplicitSavedItemCapture,
  undoExplicitSavedItemCapture,
} from "@tendnote/db/queries/conversational-capture";
import {
  conversationalCaptureConfirmationSchema,
  conversationalCaptureInputModeSchema,
} from "@tendnote/domain/conversational-capture";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

const submitSchema = z
  .object({
    interactionId: z.string().trim().min(1).max(200),
    inputMode: conversationalCaptureInputModeSchema,
    originalText: z.string().trim().min(1).max(20_000),
  })
  .strict();

const mutationSchema = z.object({ savedItemId: z.uuid() }).strict();
const changeSchema = mutationSchema.extend({ originalText: z.string().trim().min(1).max(20_000) });

export async function captureExplicitSavedItemAction(input: z.input<typeof submitSchema>) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = submitSchema.parse(input);
  const result = await captureExplicitSavedItem({
    ...parsed,
    authority: "explicit",
    ownerUserId,
    surface: "global_capture",
  });
  revalidatePath("/saved-items");
  return { confirmation: conversationalCaptureConfirmationSchema.parse(result.confirmation) };
}

export async function changeExplicitSavedItemCaptureAction(input: z.input<typeof changeSchema>) {
  const actorUserId = await requireAdmittedOwnerForAction();
  const parsed = changeSchema.parse(input);
  await changeExplicitSavedItemCapture({
    actorUserId,
    savedItemId: parsed.savedItemId,
    originalText: parsed.originalText,
  });
  revalidatePath("/saved-items");
  return { ok: true as const };
}

export async function undoExplicitSavedItemCaptureAction(input: z.input<typeof mutationSchema>) {
  const actorUserId = await requireAdmittedOwnerForAction();
  const parsed = mutationSchema.parse(input);
  await undoExplicitSavedItemCapture({ actorUserId, savedItemId: parsed.savedItemId });
  revalidatePath("/saved-items");
  return { ok: true as const };
}
