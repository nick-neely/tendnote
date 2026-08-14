import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
import { describeRecurrence, isGeneralActionRoutine } from "@tendnote/domain";
import { visibilityChoiceForScope, visibilityLabelForScope } from "@tendnote/domain/privacy";

/**
 * The compact, id-carrying reference shape every General Action Eve tool returns to
 * the channel. Keeps the persisted id (for the model's follow-up tool calls and the
 * chat card) plus the calm metadata a surface renders — Routine vs one-time, cadence,
 * timing, Area, linked people, and visibility provenance — while never leaking raw
 * owner-scoped fields. Dates are serialized to ISO strings so the channel and any
 * eval snapshot see a stable shape. Mirrors how the Follow-Up tools shape their refs
 * (ADR 0028), so chat and web read General Actions the same way.
 */
export function toGeneralActionRef(action: GeneralActionWithContext) {
  return {
    id: action.id,
    title: action.title,
    status: action.status,
    dueAt: action.dueAt ? action.dueAt.toISOString() : null,
    deferUntil: action.deferUntil ? action.deferUntil.toISOString() : null,
    // Narrow within General Actions: a Routine (recurring) vs a one-time Action, plus
    // the plain-language cadence label so the model never re-derives it (ADR 0148).
    isRoutine: isGeneralActionRoutine(action),
    recurrence: action.recurrence ? describeRecurrence(action.recurrence) : null,
    areaId: action.areaId,
    // People are lightweight context links, resolved for display so the model names
    // them instead of leaking ids (ADR 0155).
    people: action.linkedPeople.map((person) => ({
      id: person.id,
      displayName: person.displayName,
    })),
    visibilityChoice: visibilityChoiceForScope(action.scope),
    visibilityLabel: visibilityLabelForScope(action.scope),
  };
}

export type GeneralActionRef = ReturnType<typeof toGeneralActionRef>;

/**
 * The model-facing projection of a General Action reference. The persisted action id
 * is deliberately retained because several follow-up tools require it; the always-on
 * instructions keep ids out of prose. Linked-person ids remain omitted because no
 * General Action follow-up tool consumes them.
 *
 * `areaNames` is how the Area gets named. The bare `areaId` used to be stripped here
 * for good reason — a raw uuid the model could only misuse, since nothing could tell
 * it what the id meant. Now that `list_general_action_areas` exists, a caller that has
 * resolved the owner's Area names can pass them and the Area travels as a name (what
 * the model says) beside its id (what `edit_general_action` takes to re-file it). A
 * caller with no names passes none and the Area stays absent rather than arriving as
 * an unexplained id: an id nobody can name is exactly the thing this projection drops.
 */
export function toGeneralActionModelRef(
  ref: GeneralActionRef,
  areaNames?: ReadonlyMap<string, string>,
) {
  const areaName = ref.areaId ? (areaNames?.get(ref.areaId) ?? null) : null;
  return {
    id: ref.id,
    title: ref.title,
    status: ref.status,
    dueAt: ref.dueAt,
    deferUntil: ref.deferUntil,
    isRoutine: ref.isRoutine,
    recurrence: ref.recurrence,
    area: ref.areaId && areaName ? { id: ref.areaId, name: areaName } : null,
    people: ref.people.map((person) => person.displayName),
    visibilityChoice: ref.visibilityChoice,
    visibilityLabel: ref.visibilityLabel,
  };
}
