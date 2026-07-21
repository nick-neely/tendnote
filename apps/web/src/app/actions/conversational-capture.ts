"use server";

import {
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  undoExplicitCaptureOutcome,
} from "@tendnote/db/queries/conversational-capture";
import { createPerson, searchPeople } from "@tendnote/db/queries/people";
import {
  conversationalCaptureChangeTargetSchema,
  conversationalCaptureClarificationSchema,
  conversationalCaptureConfirmationSchema,
  conversationalCaptureInputModeSchema,
  conversationalCaptureUndoTargetSchema,
} from "@tendnote/domain/conversational-capture";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

const submitSchema = z
  .object({
    interactionId: z.string().trim().min(1).max(200),
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    inputMode: conversationalCaptureInputModeSchema,
    originalText: z.string().trim().min(1).max(20_000),
  })
  .strict();

const undoSchema = z.object({ target: conversationalCaptureUndoTargetSchema }).strict();
const changeSchema = z
  .object({
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    target: conversationalCaptureChangeTargetSchema,
    originalText: z.string().trim().min(1).max(20_000),
  })
  .strict();
const addPersonSchema = z.object({ displayName: z.string().trim().min(1).max(120) }).strict();

export async function addCapturePersonAction(input: z.input<typeof addPersonSchema>) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const { displayName } = addPersonSchema.parse(input);
  const matches = await searchPeople({ ownerUserId, query: displayName, limit: 10 });
  const exact = matches.filter(
    (person) => person.displayName.trim().toLocaleLowerCase() === displayName.toLocaleLowerCase(),
  );
  if (exact.length > 1) throw new Error("More than one Person has that name. Link one instead.");
  const person =
    exact[0] ??
    (await createPerson({
      ownerUserId,
      displayName,
      relationshipType: "other",
      source: "manual",
    }));
  revalidatePath("/people");
  return { displayName: person.displayName };
}

export async function captureExplicitOutcomeAction(input: z.input<typeof submitSchema>) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = submitSchema.parse(input);
  const result = await captureExplicitOutcome({
    ...parsed,
    authority: "explicit",
    ownerUserId,
    surface: "global_capture",
  });
  if (result.clarification) {
    return { clarification: conversationalCaptureClarificationSchema.parse(result.clarification) };
  }
  revalidatePath("/saved-items");
  revalidatePath("/actions");
  revalidatePath("/today");
  return { confirmation: conversationalCaptureConfirmationSchema.parse(result.confirmation) };
}

export async function changeExplicitCaptureOutcomeAction(input: z.input<typeof changeSchema>) {
  const actorUserId = await requireAdmittedOwnerForAction();
  const parsed = changeSchema.parse(input);
  const result = await changeExplicitCaptureOutcome({
    actorUserId,
    ...(parsed.clarificationAnswer ? { clarificationAnswer: parsed.clarificationAnswer } : {}),
    target: parsed.target,
    originalText: parsed.originalText,
  });
  revalidatePath("/saved-items");
  revalidatePath("/actions");
  revalidatePath("/today");
  if (result && typeof result === "object" && "clarification" in result && result.clarification) {
    return {
      clarification: conversationalCaptureClarificationSchema.parse(result.clarification),
    };
  }
  if (result && typeof result === "object" && "confirmation" in result && result.confirmation) {
    return { confirmation: conversationalCaptureConfirmationSchema.parse(result.confirmation) };
  }
  return { ok: true as const };
}

export async function undoExplicitCaptureOutcomeAction(input: z.input<typeof undoSchema>) {
  const actorUserId = await requireAdmittedOwnerForAction();
  const parsed = undoSchema.parse(input);
  await undoExplicitCaptureOutcome({ actorUserId, target: parsed.target });
  revalidatePath("/saved-items");
  revalidatePath("/actions");
  revalidatePath("/today");
  return { ok: true as const };
}
