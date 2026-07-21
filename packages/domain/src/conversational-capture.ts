import { z } from "zod";
import { formatLocalDate, zonedWallTimeToUtc } from "./brief-schedules";
import { type GeneralActionRecurrence, MAX_RECURRENCE_INTERVAL } from "./general-actions";

export const conversationalCaptureInputModeSchema = z.enum(["typed", "dictated"]);
export const conversationalCaptureSurfaceSchema = z.enum(["global_capture", "eve"]);

export const conversationalCaptureRequestSchema = z
  .object({
    authority: z.literal("explicit"),
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    interactionId: z.string().trim().min(1).max(200),
    inputMode: conversationalCaptureInputModeSchema,
    ownerUserId: z.string().trim().min(1),
    originalText: z.string().trim().min(1).max(20_000),
    surface: conversationalCaptureSurfaceSchema,
  })
  .strict();

export const conversationalCaptureChangeRequestSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    savedItemId: z.uuid(),
    originalText: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const conversationalCaptureUndoRequestSchema = z
  .object({ actorUserId: z.string().trim().min(1), savedItemId: z.uuid() })
  .strict();

export const conversationalCaptureChangeTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("edit_saved_item"), savedItemId: z.uuid() }).strict(),
  z.object({ kind: z.literal("edit_general_action"), generalActionId: z.uuid() }).strict(),
  z.object({ kind: z.literal("edit_followup"), followupId: z.uuid() }).strict(),
]);

export const conversationalCaptureUndoTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("archive_saved_item"), savedItemId: z.uuid() }).strict(),
  z.object({ kind: z.literal("archive_general_action"), generalActionId: z.uuid() }).strict(),
  z.object({ kind: z.literal("archive_followup"), followupId: z.uuid() }).strict(),
]);

export const conversationalCaptureDestinationChangeRequestSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    target: conversationalCaptureChangeTargetSchema,
    originalText: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const conversationalCaptureDestinationUndoRequestSchema = z
  .object({
    actorUserId: z.string().trim().min(1),
    target: conversationalCaptureUndoTargetSchema,
  })
  .strict();

export const conversationalSavedItemCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Saved Items"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      kind: z.enum(["Note", "Link", "Open question"]),
      visibility: z.literal("Only me"),
    }),
    change: z.object({
      kind: z.literal("edit_saved_item"),
      savedItemId: z.string().min(1),
    }),
    undo: z.object({
      kind: z.literal("archive_saved_item"),
      savedItemId: z.string().min(1),
    }),
  })
  .strict();

export const conversationalActionCaptureConfirmationSchema = z
  .object({
    destination: z.enum(["Actions", "Routines"]),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      title: z.string().min(1),
      dueAt: z.iso.datetime().nullable(),
      cadence: z.string().nullable(),
      scope: z.literal("Only me"),
    }),
    change: z.object({
      kind: z.literal("edit_general_action"),
      generalActionId: z.string().min(1),
    }),
    undo: z.object({
      kind: z.literal("archive_general_action"),
      generalActionId: z.string().min(1),
    }),
  })
  .strict();

export const conversationalFollowupCaptureConfirmationSchema = z
  .object({
    destination: z.literal("Follow-Ups"),
    groundedBySourceRecordId: z.string().min(1),
    interpreted: z.object({
      person: z.string().min(1),
      dueAt: z.iso.datetime(),
      scope: z.literal("Only me"),
    }),
    change: z.object({
      kind: z.literal("edit_followup"),
      followupId: z.string().min(1),
    }),
    undo: z.object({
      kind: z.literal("archive_followup"),
      followupId: z.string().min(1),
    }),
  })
  .strict();

export const conversationalCaptureConfirmationSchema = z.discriminatedUnion("destination", [
  conversationalSavedItemCaptureConfirmationSchema,
  conversationalActionCaptureConfirmationSchema,
  conversationalFollowupCaptureConfirmationSchema,
]);

export const conversationalCaptureClarificationSchema = z
  .object({
    field: z.enum(["timing", "cadence", "person"]),
    question: z.string().min(1),
    sourceRecordId: z.string().min(1),
    actions: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("add_person"),
              label: z.string().min(1),
              displayName: z.string().min(1),
            })
            .strict(),
          z
            .object({
              kind: z.literal("link_person"),
              label: z.literal("Link someone else"),
            })
            .strict(),
        ]),
      )
      .max(2)
      .optional(),
  })
  .strict();

export type ConversationalCaptureRequest = z.infer<typeof conversationalCaptureRequestSchema>;
export type ConversationalCaptureChangeRequest = z.infer<
  typeof conversationalCaptureChangeRequestSchema
>;
export type ConversationalCaptureUndoRequest = z.infer<
  typeof conversationalCaptureUndoRequestSchema
>;
export type ConversationalCaptureConfirmation = z.infer<
  typeof conversationalCaptureConfirmationSchema
>;
export type ConversationalCaptureClarification = z.infer<
  typeof conversationalCaptureClarificationSchema
>;
export type ConversationalCaptureChangeTarget = z.infer<
  typeof conversationalCaptureChangeTargetSchema
>;
export type ConversationalCaptureUndoTarget = z.infer<typeof conversationalCaptureUndoTargetSchema>;

export type ConversationalCaptureRoute =
  | { destination: "saved_item" }
  | {
      destination: "action";
      title: string;
      dueAt: Date | null;
      recurrence: GeneralActionRecurrence | null;
    }
  | {
      destination: "followup";
      personQuery: string;
      reason: string;
      dueAt: Date;
    }
  | {
      destination: "clarification";
      field: "timing" | "cadence" | "person";
      question: string;
    };

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

function localDateParts(timeZone: string, now: Date) {
  const [year, month, day] = formatLocalDate(timeZone, now).split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Could not resolve the owner's local date.");
  }
  return { year, month, day };
}

function localNineAm(input: { timeZone: string; year: number; month: number; day: number }) {
  return zonedWallTimeToUtc({ ...input, minute: 9 * 60 });
}

function addLocalDays(input: { timeZone: string; now: Date; days: number }) {
  const origin = localDateParts(input.timeZone, input.now);
  const date = new Date(Date.UTC(origin.year, origin.month - 1, origin.day + input.days));
  return localNineAm({
    timeZone: input.timeZone,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function resolveTiming(originalText: string, timeZone: string, now: Date) {
  if (/\btomorrow\b/i.test(originalText)) {
    return { dueAt: addLocalDays({ timeZone, now, days: 1 }), matched: "tomorrow" };
  }

  const weekdayMatch = originalText.match(
    new RegExp(`\\b(?:on\\s+)?(${WEEKDAYS.join("|")})\\b`, "i"),
  );
  if (weekdayMatch?.[1]) {
    const target = WEEKDAYS.indexOf(weekdayMatch[1].toLowerCase() as (typeof WEEKDAYS)[number]);
    const origin = localDateParts(timeZone, now);
    const current = new Date(Date.UTC(origin.year, origin.month - 1, origin.day)).getUTCDay();
    const days = (target - current + 7) % 7 || 7;
    return { dueAt: addLocalDays({ timeZone, now, days }), matched: weekdayMatch[0] };
  }

  const monthDayMatch = originalText.match(
    new RegExp(`\\bon\\s+(${MONTHS.join("|")})\\s+(\\d{1,2})\\b`, "i"),
  );
  if (monthDayMatch?.[1] && monthDayMatch[2]) {
    const month = MONTHS.indexOf(monthDayMatch[1].toLowerCase() as (typeof MONTHS)[number]) + 1;
    const day = Number(monthDayMatch[2]);
    const origin = localDateParts(timeZone, now);
    let year = origin.year;
    if (month < origin.month || (month === origin.month && day <= origin.day)) year += 1;
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCMonth() + 1 !== month || candidate.getUTCDate() !== day) {
      return { dueAt: null, matched: monthDayMatch[0], invalid: true };
    }
    return {
      dueAt: localNineAm({ timeZone, year, month, day }),
      matched: monthDayMatch[0],
    };
  }

  return { dueAt: null, matched: null, invalid: false };
}

function resolveRecurrence(originalText: string) {
  const numbered = originalText.match(/\bevery\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i);
  const named = originalText.match(/\b(daily|weekly|monthly|yearly)\b/i);
  if (numbered?.[1] && numbered[2]) {
    const interval = Number(numbered[1]);
    if (!Number.isSafeInteger(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) {
      return { recurrence: null, matched: numbered[0], invalid: true };
    }
    return {
      recurrence: {
        interval,
        unit: numbered[2].toLowerCase().replace(/s$/, "") as GeneralActionRecurrence["unit"],
      },
      matched: numbered[0],
      invalid: false,
    };
  }
  if (named?.[1]) {
    const unit = named[1].toLowerCase().replace(/ily$/, "y").replace(/ly$/, "");
    return {
      recurrence: { interval: 1, unit: unit as GeneralActionRecurrence["unit"] },
      matched: named[0],
      invalid: false,
    };
  }
  return { recurrence: null, matched: null, invalid: false };
}

function cleanActionTitle(text: string, removals: Array<string | null>) {
  let title = text.replace(
    /^\s*(?:i\s+need\s+to|i\s+have\s+to|remember\s+to|remind\s+me\s+to|todo:?)\s+/i,
    "",
  );
  for (const removal of removals) {
    if (removal)
      title = title.replace(
        new RegExp(`\\s*${removal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"),
        " ",
      );
  }
  title = title.trim().replace(/[.,]$/, "");
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "";
}

/**
 * Deterministic Capture policy. It recognizes only bounded, explicit wording;
 * everything else remains a Saved Item or asks one consequential clarification.
 * Person lookup stays outside this pure policy and must be owner-scoped.
 */
export function routeExplicitConversationalCapture(input: {
  originalText: string;
  timeZone: string;
  now: Date;
}): ConversationalCaptureRoute {
  const { originalText, timeZone, now } = input;
  const actionIntent =
    /^\s*(?:i\s+need\s+to|i\s+have\s+to|remember\s+to|remind\s+me\s+to|todo:?)/i.test(originalText);
  if (!actionIntent) return { destination: "saved_item" };

  const timing = resolveTiming(originalText, timeZone, now);
  const recurrence = resolveRecurrence(originalText);
  const vagueTiming = originalText.match(/\b(?:sometime|soon|later|eventually)\b/i)?.[0] ?? null;
  const title = cleanActionTitle(originalText, [timing.matched, recurrence.matched, vagueTiming]);

  if (timing.invalid || vagueTiming) {
    return {
      destination: "clarification",
      field: "timing",
      question: `When should I remind you to ${title.charAt(0).toLowerCase()}${title.slice(1)}?`,
    };
  }
  if (/\b(?:regularly|periodically|often)\b/i.test(originalText) && !recurrence.recurrence) {
    return {
      destination: "clarification",
      field: "cadence",
      question: `How often should ${title.charAt(0).toLowerCase()}${title.slice(1)} repeat?`,
    };
  }
  if (recurrence.invalid) {
    return {
      destination: "clarification",
      field: "cadence",
      question: `How often should ${title.charAt(0).toLowerCase()}${title.slice(1)} repeat?`,
    };
  }

  const personMatch = originalText.match(
    /\bfollow\s+up\s+with\s+(.+?)(?=\s+(?:tomorrow|on\s+|every\s+|daily\b|weekly\b|monthly\b|yearly\b)|[.,]|$)/i,
  );
  if (personMatch?.[1]) {
    if (!timing.dueAt) {
      return {
        destination: "clarification",
        field: "timing",
        question: `When should I remind you to follow up with ${personMatch[1].trim()}?`,
      };
    }
    return {
      destination: "followup",
      dueAt: timing.dueAt,
      personQuery: personMatch[1].trim(),
      reason: "Follow up",
    };
  }

  if (
    /^\s*(?:remember\s+to|remind\s+me\s+to)\b/i.test(originalText) &&
    !timing.dueAt &&
    !recurrence.recurrence
  ) {
    return {
      destination: "clarification",
      field: "timing",
      question: `When should I remind you to ${title.charAt(0).toLowerCase()}${title.slice(1)}?`,
    };
  }

  return {
    destination: "action",
    dueAt: timing.dueAt,
    recurrence: recurrence.recurrence,
    title,
  };
}
