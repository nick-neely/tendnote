/**
 * The closed set of Activation Milestones (ADR 0242): content-free, per-account,
 * operator-facing timestamps for the steps toward First Value. A new milestone
 * is a product decision and a disclosed-boundary change, not a logging
 * convenience, so the set is a literal rather than an open string.
 */
export const FIRST_VALUE_STEPS = [
  "first_person_created",
  "first_memory_confirmed",
  "first_followup_scheduled",
  "first_grounded_eve_answer",
] as const;

export const ACTIVATION_MILESTONES = [...FIRST_VALUE_STEPS, "first_value_reached"] as const;

export type FirstValueStep = (typeof FIRST_VALUE_STEPS)[number];
export type ActivationMilestone = (typeof ACTIVATION_MILESTONES)[number];

/**
 * First Value is reached once every step has happened. The walkthrough's
 * "same person, first sitting" is judged by the operator from the timestamps;
 * a milestone holds no record, so it cannot say which person a step was about.
 */
export function reachesFirstValue(reached: Iterable<ActivationMilestone>): boolean {
  const set = new Set(reached);
  return FIRST_VALUE_STEPS.every((step) => set.has(step));
}
