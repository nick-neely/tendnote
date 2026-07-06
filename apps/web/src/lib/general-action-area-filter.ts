import type { GeneralActionAreaView } from "@/lib/general-action-area-view";

/** The most chips the calm filter row shows before folding the rest into "+N more". */
export const AREA_CHIP_CAP = 6;

/**
 * Filters Actions to a single Area, or returns them untouched when no Area is
 * selected ("All"). Pure so the surface's active/resolved filtering is testable
 * without a DOM (the client filters in place for instant feedback).
 */
export function filterActionsByArea<T extends { areaId: string | null }>(
  actions: T[],
  areaId: string | null,
): T[] {
  return areaId ? actions.filter((action) => action.areaId === areaId) : actions;
}

/**
 * Resolves the effective selection: a chosen Area only counts while it is still an
 * active Area, so archiving the Area currently filtered on falls back to "All"
 * rather than showing an empty, un-clearable view.
 */
export function resolveActiveAreaId(
  selectedAreaId: string | null,
  activeAreas: GeneralActionAreaView[],
): string | null {
  return selectedAreaId && activeAreas.some((area) => area.id === selectedAreaId)
    ? selectedAreaId
    : null;
}

/**
 * Caps the visible filter chips so many Areas can't break the calm surface: shows
 * the first `cap` active Areas, but always keeps the currently selected Area visible
 * (swapping it in if it sits past the cap), and reports how many are folded away
 * into the "+N more" affordance.
 */
export function pickVisibleAreaChips(
  activeAreas: GeneralActionAreaView[],
  selectedAreaId: string | null,
  cap: number = AREA_CHIP_CAP,
): { visible: GeneralActionAreaView[]; overflow: number } {
  if (activeAreas.length <= cap) {
    return { visible: activeAreas, overflow: 0 };
  }

  let visible = activeAreas.slice(0, cap);
  if (selectedAreaId && !visible.some((area) => area.id === selectedAreaId)) {
    const selected = activeAreas.find((area) => area.id === selectedAreaId);
    if (selected) {
      // Keep the active filter in reach by taking its slot from the last shown chip.
      visible = [...activeAreas.slice(0, cap - 1), selected];
    }
  }

  return { visible, overflow: activeAreas.length - visible.length };
}
