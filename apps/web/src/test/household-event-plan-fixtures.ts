import type { HouseholdEventPlan } from "@tendnote/domain/household-event-plans";

/** One stable household-native Plan for view and interaction contracts. */
export function householdEventPlanFixture(
  overrides: Partial<HouseholdEventPlan> = {},
): HouseholdEventPlan {
  return {
    id: "plan-1",
    householdId: "household-1",
    createdByUserId: "ana",
    lastActorUserId: "ana",
    title: "School night supper",
    details: null,
    plannedFor: null,
    status: "active",
    archivedAt: null,
    calendarConnectionId: null,
    calendarId: null,
    calendarProviderEventId: null,
    version: 1,
    createdAt: new Date("2026-08-01T09:00:00Z"),
    updatedAt: new Date("2026-08-01T09:00:00Z"),
    ...overrides,
  };
}
