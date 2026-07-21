"use server";

import {
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  undoExplicitCaptureOutcome,
} from "@tendnote/db/queries/conversational-capture";
import { resolveOrCreateAndLinkPersonToSourceRecord } from "@tendnote/db/queries/source-records";
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
const addPersonSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    sourceRecordId: z.string().min(1),
    unresolvedMentionId: z.string().min(1).optional(),
  })
  .strict();

function revalidateCapturePaths() {
  for (const path of ["/saved-items", "/actions", "/people", "/assets", "/review", "/today"]) {
    revalidatePath(path);
  }
}

export async function addCapturePersonAction(input: z.input<typeof addPersonSchema>) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const { displayName, sourceRecordId, unresolvedMentionId } = addPersonSchema.parse(input);
  const { person } = await resolveOrCreateAndLinkPersonToSourceRecord({
    ownerUserId,
    sourceRecordId,
    displayName,
    role: "primary",
    ...(unresolvedMentionId ? { unresolvedMentionId } : {}),
  });
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
  revalidateCapturePaths();
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
  revalidateCapturePaths();
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
  revalidateCapturePaths();
  return { ok: true as const };
}
