import { GeneralActionValidationError } from "@tendnote/domain";
import {
  type ReminderOccurrenceIntent,
  type ReminderRecordKind,
  type ReminderSchedule,
  reminderScheduleChoiceSchema,
  resolveReminderIntendedAt,
} from "@tendnote/domain/reminders";
import type { MutationOutcome } from "../affected-scopes";
import type {
  CreateActiveGeneralActionInput,
  CreateGeneralActionWithReminderInput,
  CreateGeneralActionWithReminderResult,
  GeneralActionWithContext,
} from "./types";

type SavedGeneralActionReminder = {
  schedule: ReminderSchedule;
  occurrenceIntent: ReminderOccurrenceIntent | null;
  optIn: { state: "offer" | "none"; clientInstallationId: string | null };
};

type CreateAction = (
  input: CreateActiveGeneralActionInput,
) => Promise<MutationOutcome<GeneralActionWithContext>>;

type SaveReminder = (input: {
  ownerUserId: string;
  recordKind: Extract<ReminderRecordKind, "general_action" | "routine">;
  recordId: string;
  clientInstallationId?: string;
  timeZone: string;
  schedule: NonNullable<CreateGeneralActionWithReminderInput["reminder"]>["schedule"];
  now: Date;
}) => Promise<MutationOutcome<SavedGeneralActionReminder>>;

/**
 * Shared owner-scoped Action-plus-reminder orchestration.
 *
 * The dependencies are explicit so the operation can be exercised without a
 * database. Production supplies the normal Action lifecycle and Reminder service;
 * the operation itself owns validation, split failure reporting, and affected-scope
 * composition for every caller.
 */
export async function createGeneralActionWithReminderOperation(
  input: CreateGeneralActionWithReminderInput,
  deps: { createAction: CreateAction; saveReminder: SaveReminder },
): Promise<MutationOutcome<CreateGeneralActionWithReminderResult>> {
  if (!input.reminder) {
    const actionOutcome = await deps.createAction(input);
    return {
      result: { action: actionOutcome.result, reminder: null },
      affectedScopes: actionOutcome.affectedScopes,
    };
  }

  const now = input.reminder.now ?? new Date();
  assertGeneralActionReminderTiming(input, now);

  const { reminder, ...actionInput } = input;
  const actionOutcome = await deps.createAction(actionInput);

  try {
    // A recurring General Action is a Routine in the reminder contract. The
    // persistence table is shared, but eligibility and occurrence materialization
    // are keyed by record kind, so preserving this distinction is what makes a
    // relative schedule attach to every occurrence rather than look like a
    // one-time Action.
    const recordKind = input.recurrence ? ("routine" as const) : ("general_action" as const);
    const reminderOutcome = await deps.saveReminder({
      ownerUserId: actionOutcome.result.ownerUserId,
      recordKind,
      recordId: actionOutcome.result.id,
      timeZone: reminder.timeZone,
      schedule: reminder.schedule,
      now,
      ...(reminder.clientInstallationId
        ? { clientInstallationId: reminder.clientInstallationId }
        : {}),
    });
    const saved = reminderOutcome.result;
    if (!saved.occurrenceIntent) {
      return {
        result: {
          action: actionOutcome.result,
          reminder: { status: "failed", reason: "unavailable" },
        },
        affectedScopes: actionOutcome.affectedScopes,
      };
    }

    return {
      result: {
        action: actionOutcome.result,
        reminder: {
          status: "scheduled",
          schedule: saved.schedule,
          occurrenceIntent: saved.occurrenceIntent,
          optIn: {
            state: saved.optIn.state,
            clientInstallationId: saved.optIn.clientInstallationId ?? null,
          },
        },
      },
      affectedScopes: [...actionOutcome.affectedScopes, ...reminderOutcome.affectedScopes],
    };
  } catch (error) {
    // The Action already committed. Keep the split outcome truthful and opaque to
    // the model while retaining an operator-visible trail for the failed scheduler.
    console.error("Reminder scheduling failed after creating a General Action.", error);
    return {
      result: {
        action: actionOutcome.result,
        reminder: { status: "failed", reason: "unavailable" },
      },
      affectedScopes: actionOutcome.affectedScopes,
    };
  }
}

function assertGeneralActionReminderTiming(input: CreateGeneralActionWithReminderInput, now: Date) {
  assertValidReminderClock(now);
  const dueAt = requireConcreteDueAt(input.dueAt);
  const choice = parseReminderChoice(input.reminder?.schedule);
  assertRoutineReminderChoice(input.recurrence, choice);
  const intendedAt = resolveStrictReminderTime({
    dueAt,
    timeZone: input.reminder?.timeZone ?? "UTC",
    choice,
  });
  assertFutureReminderTime(intendedAt, now);
}

type ReminderChoice = ReturnType<typeof reminderScheduleChoiceSchema.parse>;

function assertValidReminderClock(now: Date) {
  if (!Number.isNaN(now.getTime())) return;
  throw new GeneralActionValidationError(
    "I could not resolve the current time for that Reminder Schedule. Ask again with a concrete future time.",
  );
}

function requireConcreteDueAt(dueAt: Date | null | undefined) {
  if (dueAt && !Number.isNaN(dueAt.getTime())) return dueAt;
  throw new GeneralActionValidationError(
    "A Reminder Schedule needs a concrete Action due date. Ask for the date before creating the Action.",
  );
}

function parseReminderChoice(schedule: unknown): ReminderChoice {
  try {
    return reminderScheduleChoiceSchema.parse(schedule);
  } catch {
    throw new GeneralActionValidationError(
      "That Reminder Schedule is not a valid concrete time. Ask for a specific alert time.",
    );
  }
}

function assertRoutineReminderChoice(recurrence: unknown, choice: ReminderChoice) {
  if (!recurrence || choice.kind !== "exact") return;
  throw new GeneralActionValidationError(
    "A recurring Action needs a Reminder Schedule relative to each occurrence.",
  );
}

function resolveStrictReminderTime(input: {
  dueAt: Date;
  timeZone: string;
  choice: ReminderChoice;
}) {
  try {
    return resolveReminderIntendedAt({
      occursAt: input.dueAt,
      timeSemantics: "date_only",
      timeZone: input.timeZone,
      choice: input.choice,
      wallTimeMode: "strict",
    });
  } catch (error) {
    throwReminderResolutionError(error);
  }
}

function throwReminderResolutionError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (/ambiguous/i.test(message)) {
    throw new GeneralActionValidationError(
      "That local reminder time occurs twice when clocks fall back. Choose a different concrete time.",
    );
  }
  if (/does not exist/i.test(message)) {
    throw new GeneralActionValidationError(
      "That local reminder time is skipped when clocks move forward. Choose a different concrete time.",
    );
  }
  throw new GeneralActionValidationError(
    "I could not resolve that Reminder Schedule in the owner's timezone. Ask for a concrete future time.",
  );
}

function assertFutureReminderTime(intendedAt: Date, now: Date) {
  if (intendedAt.getTime() > now.getTime()) return;
  throw new GeneralActionValidationError(
    "That Reminder Schedule is already in the past. Ask for a future alert time instead of guessing.",
  );
}
