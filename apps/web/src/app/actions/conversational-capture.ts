"use server";

import {
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  undoExplicitCaptureOutcome,
} from "@tendnote/db/queries/conversational-capture";
import { getGeneralAction } from "@tendnote/db/queries/general-actions";
import { affectedScopesForPerson } from "@tendnote/db/queries/people";
import { saveReminder, scheduleExplicitCaptureReminders } from "@tendnote/db/queries/reminders";
import { resolveOrCreateAndLinkPersonToSourceRecord } from "@tendnote/db/queries/source-records";
import {
  conversationalCaptureChangeTargetSchema,
  conversationalCaptureClarificationSchema,
  conversationalCaptureConfirmationSchema,
  conversationalCaptureInputModeSchema,
  conversationalCaptureUndoTargetSchema,
} from "@tendnote/domain/conversational-capture";
import {
  reminderScheduleChoiceSchema,
  reminderTimeSemanticsForRecordKind,
} from "@tendnote/domain/reminders";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";
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

export async function changeExplicitCaptureReminderAction(
  input: z.input<typeof changeReminderSchema>,
) {
  return runOwnerAction({
    schema: changeReminderSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const reference =
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
            }
          : parsed.target.kind === "edit_followup"
            ? {
                recordKind: "follow_up" as const,
                recordId: parsed.target.followupId,
              }
            : parsed.target.kind === "edit_saved_item"
              ? {
                  recordKind: "saved_item" as const,
                  recordId: parsed.target.savedItemId,
                }
              : null;
      if (!reference) throw new Error("That captured record cannot have a Reminder schedule.");
      const target = {
        ...reference,
        timeSemantics: reminderTimeSemanticsForRecordKind(reference.recordKind),
      };
      return {
        outcome: await saveReminder({
          ownerUserId,
          ...target,
          clientInstallationId: parsed.clientInstallationId,
          timeZone: parsed.timeZone,
          schedule: parsed.schedule,
          now: new Date(),
        }),
        target,
      };
    },
    affectedScopes: ({ outcome }) => outcome.affectedScopes,
    result: ({ outcome, target }) => ({
      reminderSchedule: toReminderScheduleView(outcome.result.schedule, target.timeSemantics).label,
      reminderOptInOffered: outcome.result.optIn.state === "offer",
    }),
  });
}

export async function addCapturePersonAction(input: z.input<typeof addPersonSchema>) {
  return runOwnerAction({
    schema: addPersonSchema,
    input,
    body: async ({ ownerUserId, input: { displayName, sourceRecordId, unresolvedMentionId } }) => ({
      ...(await resolveOrCreateAndLinkPersonToSourceRecord({
        ownerUserId,
        sourceRecordId,
        displayName,
        role: "primary",
        ...(unresolvedMentionId ? { unresolvedMentionId } : {}),
      })),
      ownerUserId,
    }),
    affectedScopes: ({ ownerUserId, person }) =>
      affectedScopesForPerson({ ownerUserId, personId: person.id }),
    result: ({ ownerUserId, person }) => ({
      displayName: person.displayName,
      personId: person.id,
      affectedScopes: affectedScopesForPerson({
        ownerUserId,
        personId: person.id,
      }),
      revision: person.updatedAt?.toISOString?.() ?? `created:${person.id}`,
    }),
  });
}

export async function captureExplicitOutcomeAction(input: z.input<typeof submitSchema>) {
  return runOwnerAction({
    schema: submitSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      const result = await captureExplicitOutcome({
        ...parsed,
        authority: "explicit",
        ownerUserId,
        surface: "global_capture",
      });
      if (result.clarification) {
        return { capture: result, reminder: null };
      }
      const reminder = await scheduleExplicitCaptureReminders({
        ownerUserId,
        originalText: parsed.originalText,
        clientInstallationId: parsed.clientInstallationId,
        timeZone: parsed.timeZone,
        result,
        now: new Date(),
      });
      return { capture: result, reminder };
    },
    affectedScopes: ({ capture, reminder }) => [
      ...(capture.affectedScopes ?? []),
      ...(reminder?.affectedScopes ?? []),
    ],
    result: ({ capture, reminder }) =>
      capture.clarification
        ? {
            clarification: conversationalCaptureClarificationSchema.parse(capture.clarification),
          }
        : {
            confirmation: conversationalCaptureConfirmationSchema.parse(
              reminder?.result.confirmation,
            ),
            reminderOptInOffered: reminder?.result.reminderOptInOffered ?? false,
          },
  });
}

export async function changeExplicitCaptureOutcomeAction(input: z.input<typeof changeSchema>) {
  return runOwnerAction({
    schema: changeSchema,
    input,
    budget: { costCategory: "server-action" },
    body: ({ ownerUserId, input: parsed }) =>
      changeExplicitCaptureOutcome({
        actorUserId: ownerUserId,
        ...(parsed.clarificationAnswer ? { clarificationAnswer: parsed.clarificationAnswer } : {}),
        target: parsed.target,
        originalText: parsed.originalText,
      }),
    affectedScopes: affectedScopesFromUnknown,
    result: (result) => {
      if (
        result &&
        typeof result === "object" &&
        "clarification" in result &&
        result.clarification
      ) {
        return {
          clarification: conversationalCaptureClarificationSchema.parse(result.clarification),
        };
      }
      if (result && typeof result === "object" && "confirmation" in result && result.confirmation) {
        return { confirmation: conversationalCaptureConfirmationSchema.parse(result.confirmation) };
      }
      return { ok: true as const };
    },
  });
}

export async function undoExplicitCaptureOutcomeAction(input: z.input<typeof undoSchema>) {
  return runOwnerAction({
    schema: undoSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      undoExplicitCaptureOutcome({ actorUserId: ownerUserId, target: parsed.target }),
    affectedScopes: affectedScopesFromUnknown,
    result: () => ({ ok: true as const }),
  });
}

function affectedScopesFromUnknown(result: unknown) {
  if (!result || typeof result !== "object" || !("affectedScopes" in result)) return [];
  const affectedScopes = result.affectedScopes;
  if (Array.isArray(affectedScopes)) {
    return affectedScopes;
  }
  return [];
}
