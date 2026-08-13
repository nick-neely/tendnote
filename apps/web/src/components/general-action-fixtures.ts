import { type GeneralActionView, resolveGeneralActionAuthority } from "@/lib/general-action-view";

/**
 * Shared `GeneralActionView` builder for component tests: a calm, unscheduled, private,
 * open Action by default. Each suite overrides only the fields its assertions care about,
 * so the ~20-field view shape lives in one place instead of being re-declared per test file.
 *
 * `authority` follows from the ownership form and the viewer's relationship to the
 * record, exactly as the real projection derives it, so a suite that flips `owned`
 * or `ownership` cannot accidentally test a row against an authority set the server
 * would never have produced.
 */
export function generalActionViewFixture(
  overrides: Partial<GeneralActionView> = {},
): GeneralActionView {
  const ownership = overrides.ownership ?? "member_owned";
  const owned = overrides.owned ?? true;

  return {
    id: "11111111-1111-1111-1111-111111111111",
    revision: "2026-07-24T00:00:00.000Z",
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
    sharedWithCount: 0,
    owned,
    ownerUserId: "owner-1",
    viewerUserId: "owner-1",
    ownership,
    occurrenceVersion: 0,
    responsibilityHolderUserId: null,
    responsibilityHolderLabel: null,
    authority: resolveGeneralActionAuthority(ownership, owned),
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
