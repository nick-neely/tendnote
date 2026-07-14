import type { GeneralActionView } from "@/lib/general-action-view";

/**
 * Shared `GeneralActionView` builder for component tests: a calm, unscheduled, private,
 * open Action by default. Each suite overrides only the fields its assertions care about,
 * so the ~20-field view shape lives in one place instead of being re-declared per test file.
 */
export function generalActionViewFixture(
  overrides: Partial<GeneralActionView> = {},
): GeneralActionView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Replace the water filter",
    notes: null,
    links: [],
    assetHints: [],
    linkedAssets: [],
    linkedPeople: [],
    status: "open",
    recurrence: null,
    isRoutine: false,
    recurrenceLabel: null,
    scope: "private",
    visibilityLabel: "Only me",
    owned: true,
    ownerUserId: "owner-1",
    areaId: null,
    dueAtISO: null,
    dueAtDate: "",
    deferUntilISO: null,
    deferUntilDate: "",
    surfaceState: "unscheduled",
    surfaceLabel: "No date",
    ...overrides,
  };
}
