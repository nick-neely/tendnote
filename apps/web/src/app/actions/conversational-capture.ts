"use server";

import {
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  undoExplicitCaptureOutcome,
} from "@tendnote/db/queries/conversational-capture";
import { getGeneralAction } from "@tendnote/db/queries/general-actions";
import { saveReminder, scheduleExplicitCaptureReminders } from "@tendnote/db/queries/reminders";
import { resolveOrCreateAndLinkPersonToSourceRecord } from "@tendnote/db/queries/source-records";
import {
  conversationalCaptureChangeTargetSchema,
  conversationalCaptureClarificationSchema,
  conversationalCaptureConfirmationSchema,
  conversationalCaptureInputModeSchema,
  conversationalCaptureUndoTargetSchema,
} from "@tendnote/domain/conversational-capture";
import { reminderScheduleChoiceSchema } from "@tendnote/domain/reminders";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { invalidatePersonMutation } from "@/lib/cache/people-mutation-scopes";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";

const submitSchema = z
  .object({
    interactionId: z.string().trim().min(1).max(200),
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    inputMode: conversationalCaptureInputModeSchema,
    originalText: z.string().trim().min(1).max(20_000),
    clientInstallationId: z.string().trim().min(12).max(200).optional(),
    timeZone: z.string().trim().min(1).max(100).optional(),
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
const changeReminderSchema = z
  .object({
    target: conversationalCaptureChangeTargetSchema,
    clientInstallationId: z.string().trim().min(12).max(200),
    timeZone: z.string().trim().min(1).max(100),
    schedule: reminderScheduleChoiceSchema,
  })
  .strict();

function revalidateCapturePaths() {
  for (const path of ["/saved-items", "/actions", "/people", "/assets", "/review", "/today"]) {
    revalidatePath(path);
  }
}

export async function changeExplicitCaptureReminderAction(
  input: z.input<typeof changeReminderSchema>,
) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = changeReminderSchema.parse(input);
  const target =
    parsed.target.kind === "edit_general_action"
      ? {
          recordKind: (
            await getGeneralAction({
              actorUserId: ownerUserId,
              generalActionId: parsed.target.generalActionId,
            })
          ).recurrence
            ? ("routine" as const)
            : ("general_action" as const),
          recordId: parsed.target.generalActionId,
          timeSemantics: "date_only" as const,
        }
      : parsed.target.kind === "edit_followup"
        ? {
            recordKind: "follow_up" as const,
            recordId: parsed.target.followupId,
            timeSemantics: "date_only" as const,
          }
        : parsed.target.kind === "edit_saved_item"
          ? {
              recordKind: "saved_item" as const,
              recordId: parsed.target.savedItemId,
              timeSemantics: "instant" as const,
            }
          : null;
  if (!target) throw new Error("That captured record cannot have a Reminder schedule.");
  const result = await saveReminder({
    ownerUserId,
    ...target,
    clientInstallationId: parsed.clientInstallationId,
    timeZone: parsed.timeZone,
    schedule: parsed.schedule,
    now: new Date(),
  });
  return {
    reminderSchedule: toReminderScheduleView(result.schedule, target.timeSemantics).label,
  };
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
  const affectedScopes = invalidatePersonMutation({ ownerUserId, personId: person.id });
  return {
    displayName: person.displayName,
    personId: person.id,
    affectedScopes,
    revision: person.updatedAt?.toISOString?.() ?? `created:${person.id}`,
  };
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
  const confirmation = await scheduleExplicitCaptureReminders({
    ownerUserId,
    originalText: parsed.originalText,
    clientInstallationId: parsed.clientInstallationId,
    timeZone: parsed.timeZone,
    result,
    now: new Date(),
  });
  revalidateCapturePaths();
  return { confirmation: conversationalCaptureConfirmationSchema.parse(confirmation) };
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
