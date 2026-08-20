import {
  createGeneralAction,
  createGeneralActionWithReminder,
  type GeneralActionReminderResult,
} from "@tendnote/db/queries/general-actions";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import {
  assertIsoCalendarDate,
  GeneralActionValidationError,
  generalActionLinkSchema,
  generalActionRecurrenceSchema,
} from "@tendnote/domain";
import {
  formatReminderScheduleLabel,
  reminderScheduleChoiceSchema,
} from "@tendnote/domain/reminders";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const canonicalDueAtSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

const inputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("The action itself, in the user's words (e.g. 'Replace the fridge water filter')."),
  notes: z
    .string()
    .optional()
    .describe("Optional extra detail. Omit if the title already says everything."),
  dueAt: canonicalDueAtSchema
    .optional()
    .describe(
      "Optional concrete due date as an ISO 8601 string. Resolve relative phrases like 'next Friday' to a concrete date first; if the timing is genuinely ambiguous, ask instead of guessing. Omit for an unscheduled 'someday' action — a General Action does not need a date.",
    ),
  reminderSchedule: reminderScheduleChoiceSchema
    .optional()
    .describe(
      "Optional explicit notification schedule. Pass this only when the user directly asks to be reminded or notified about this Action at a concrete time. The Action must also have a concrete dueAt. Use exact localTime for a clock time, or relative leadMinutes for a lead time before the due date. Never add a schedule from an inferred suggestion; ask when the requested timing is ambiguous.",
    ),
  recurrence: generalActionRecurrenceSchema
    .nullish()
    .describe(
      "Optional simple cadence — repeat every `interval` `unit`s (e.g. {interval: 6, unit: 'month'}). Its presence makes this a Routine. Only for a genuine recurring chore ('every 6 months'), never for a one-off. Simple cadence only: no per-occurrence rules.",
    ),
  areaId: z
    .uuid()
    .optional()
    .describe(
      "Optional Area (a flat life category) to file this under. Take the id from list_general_action_areas — never invent or retype one. Omit to create the explicitly requested Action unfiled when no matching Area exists; do not defer creation while waiting for filing.",
    ),
  personIds: z
    .array(z.uuid())
    .optional()
    .describe(
      "Optional people this action is about — context links only, resolved with search_people first. Linking a person never turns this into a follow-up for them.",
    ),
  links: z
    .array(generalActionLinkSchema)
    .optional()
    .describe("Optional reference links (a URL with an optional label). Not file attachments."),
  sourceRecordId: z
    .uuid()
    .optional()
    .describe(
      "Optional grounding: the source record this action came from (e.g. a note you just logged). Omit for a plain user-created action.",
    ),
});

/**
 * Thin wrapper over the shared owner-scoped General Action lifecycle: creates an
 * ACTIVE `open` action directly, or a Routine when a cadence is present (ADRs 0144,
 * 0148, 0159). Only fires on an explicit user ask in the current turn — Eve never
 * invents an active action from its own initiative or from stale context; when the
 * user is only musing or asking for ideas, propose a review-gated suggestion instead
 * (`suggest_general_action`). The shared layer owner-scopes the write, defaults
 * visibility to private (fail-closed), and verifies grounding, Area, and people links
 * before attaching them. Returns a compact persisted reference, never a raw id in prose.
 */
export default defineTool({
  description:
    "Create an ACTIVE General Action (a durable to-do) directly, or a Routine when a recurring cadence is given. Only call this when the user explicitly asks to add/create/track an action in the current turn (e.g. 'add an action to replace the water filter', 'set up a routine to change the filters every 6 months') - never invent one on their behalf, and never from your own initiative or an inference. If the user is only brainstorming or asking you to plan, propose review-gated suggestions with suggest_general_action / plan_suggested_general_actions instead. A due date is optional (omit for an unscheduled 'someday' action); resolve relative timing to a concrete date, and ask if it is ambiguous. If an explicit request names an Area that does not exist, create the Action now with `areaId` omitted; an unfiled Action is valid and you must not wait for or invent filing. If the user explicitly asks to be reminded or notified, pass reminderSchedule together with the concrete dueAt; the saved result distinguishes the Action from its notification, and a failed notification must be reported as failed. Never attach a reminder to an inferred suggestion. Resolve any people with search_people first - they are context links, not follow-ups. Returns the persisted action reference (id, title, status, timing, cadence); refer to it by its title, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    if (input.dueAt !== undefined) {
      try {
        assertIsoCalendarDate(input.dueAt);
      } catch {
        throw new GeneralActionValidationError("Use a real calendar date for the Action due date.");
      }
      if (!canonicalDueAtSchema.safeParse(input.dueAt).success) {
        throw new GeneralActionValidationError(
          "Use a concrete ISO 8601 date or date-time for the Action due date.",
        );
      }
    }
    const dueAt = input.dueAt === undefined ? null : new Date(input.dueAt);
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw new GeneralActionValidationError("Use a concrete ISO 8601 Action due date.");
    }
    if (input.reminderSchedule && !dueAt) {
      throw new GeneralActionValidationError(
        "A Reminder Schedule needs a concrete Action due date. Ask for the date before creating the Action.",
      );
    }
    const reminderSchedule = input.reminderSchedule;

    const actionInput = {
      ownerUserId,
      title: input.title,
      notes: input.notes ?? null,
      // Parsed here; the shared layer treats a General Action as unscheduled when absent.
      dueAt,
      recurrence: input.recurrence ?? null,
      areaId: input.areaId ?? null,
      personIds: input.personIds,
      links: input.links,
      sourceRecordId: input.sourceRecordId ?? null,
    };

    if (!reminderSchedule) {
      const outcome = await withModelSafeStoreErrors(() => createGeneralAction(actionInput));
      await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
      return { action: toGeneralActionRef(outcome.result) };
    }

    // The owner day is the authority for both the local wall-clock interpretation
    // and the timezone persisted with the schedule. No agent/client installation id
    // is available or synthesized here; browser opt-in remains installation-scoped.
    const ownerDay = await withModelSafeStoreErrors(() => getOwnerTodayContext({ ownerUserId }));
    const outcome = await withModelSafeStoreErrors(() =>
      createGeneralActionWithReminder({
        ...actionInput,
        dueAt: dueAt as Date,
        reminder: {
          schedule: reminderSchedule,
          timeZone: ownerDay.timeZone,
          now: ownerDay.now,
        },
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      action: toGeneralActionRef(outcome.result.action),
      reminder: toReminderOutput(outcome.result.reminder),
    };
  },
  // The chat renders a confirmation card carrying the action's title, timing, and
  // cadence, so the model only acknowledges it — it must not reprint what the card shows.
  toModelOutput(output) {
    const reminder = output.reminder ?? null;
    const guidance =
      reminder?.status === "failed"
        ? "The Action was created, but no notification was scheduled. Say that plainly, do not claim an alert exists, and do not retry the create call unless the user explicitly asks."
        : reminder?.status === "scheduled"
          ? "The Action and its concrete Reminder Schedule are shown to the user in a card. Acknowledge both in one short sentence without restating the card's title, date, or alert time."
          : "It's on the active ledger and shown to the user as a card. Acknowledge it in one short sentence; don't restate the title, date, or cadence the card already shows.";
    return {
      type: "json" as const,
      value: {
        created: true,
        action: toGeneralActionModelRef(output.action),
        rendered: "The new action is shown to the user in a card.",
        ...(reminder ? { reminder } : {}),
        guidance,
      },
    };
  },
});

function toReminderOutput(reminder: GeneralActionReminderResult | null) {
  if (!reminder) return null;
  if (reminder.status === "failed") return reminder;
  return {
    status: "scheduled" as const,
    label: formatReminderScheduleLabel(reminder.schedule),
    timeZone: reminder.schedule.timeZone,
    intendedAt: reminder.schedule.intendedAt.toISOString(),
    optInOffered: reminder.optIn.state === "offer",
  };
}
