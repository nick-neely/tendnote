import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import { filterActionsByArea } from "@/lib/general-action-area-filter";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import type { GeneralActionView } from "@/lib/general-action-view";

// The real actions pull in `server-only`; the surface only needs them to exist as
// callable handlers, which these render tests never fire.
vi.mock("@/app/actions/general-actions", () => ({
  archiveGeneralActionAction: vi.fn(),
  completeGeneralActionAction: vi.fn(),
  createGeneralActionAction: vi.fn(),
  deferGeneralActionAction: vi.fn(),
  dismissGeneralActionAction: vi.fn(),
  editGeneralActionAction: vi.fn(),
  listGeneralActionHistoryAction: vi.fn(),
  pauseGeneralActionAction: vi.fn(),
  promoteAssetHintAction: vi.fn(),
  reopenGeneralActionAction: vi.fn(),
  resumeGeneralActionAction: vi.fn(),
}));

vi.mock("@/app/actions/reminders", () => ({
  clearReminderAction: vi.fn(),
  clearGeneralActionReminderAction: vi.fn(),
  registerReminderInstallationAction: vi.fn(),
  saveGeneralActionReminderAction: vi.fn(),
  saveReminderAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

vi.mock("@/app/actions/general-action-areas", () => ({
  archiveGeneralActionAreaAction: vi.fn(),
  createGeneralActionAreaAction: vi.fn(),
  renameGeneralActionAreaAction: vi.fn(),
  unarchiveGeneralActionAreaAction: vi.fn(),
}));

// vitest hoists `vi.mock` factories above imports, so this standard mock boilerplate
// cannot be shared without fragile dynamic-import gymnastics that obscure the idiom.
// fallow-ignore-next-line code-duplication
vi.mock("@/app/actions/suggested-general-actions", () => ({
  acceptSuggestedGeneralActionAction: vi.fn(),
  dismissSuggestedGeneralActionAction: vi.fn(),
  editSuggestedGeneralActionAction: vi.fn(),
  ignoreSuggestedGeneralActionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ActionsSurface } from "./actions-surface";

const actionView = generalActionViewFixture;

function area(id: string, name: string, archived = false): GeneralActionAreaView {
  return { id, name, archived };
}

const HOME = area("home-id", "Home");
const HEALTH = area("health-id", "Health");

function render(active: GeneralActionView[], areas: GeneralActionAreaView[]) {
  return renderToStaticMarkup(
    <ActionsSurface active={active} areas={areas} resolved={[]} resolvedTruncated={false} />,
  );
}

describe("ActionsSurface area filter", () => {
  it("renders a chip for each active area plus All", () => {
    const html = render([actionView()], [HOME, HEALTH]);

    expect(html).toContain(">All<");
    expect(html).toContain(">Home<");
    expect(html).toContain(">Health<");
    // The management affordance is present; label reflects that areas exist.
    expect(html).toContain("Manage areas");
  });

  /**
   * With no Areas there is nothing to filter, so the row is the one control that
   * makes some. "No areas yet. Areas group related actions." used to sit beside
   * it - a caption explaining a filter row that was not there.
   */
  it("shows the Add areas affordance and no chips when there are no active areas", () => {
    const html = render([actionView()], []);

    expect(html).toContain("Add areas");
    expect(html).not.toContain("No areas yet");
    expect(html).not.toContain(">All<");
  });

  it("labels each action with its area under the All view", () => {
    const html = render([actionView({ areaId: "home-id" })], [HOME, HEALTH]);

    // The default (All) view surfaces the action's area as a quiet label.
    expect(html).toContain("Home");
  });
});

describe("ActionsSurface routines", () => {
  it("shows a routine's cadence label and a Routine-aware complete control", () => {
    const html = render(
      [actionView({ isRoutine: true, recurrenceLabel: "Every 6 months" })],
      [HOME],
    );

    expect(html).toContain("Every 6 months");
    // A routine completes an occurrence rather than resolving, so its button reads
    // differently from a one-time action's "Complete".
    expect(html).toContain("Done for now");
    // The word "Routine" is legible to AT even though the visible chip is glyph+cadence.
    expect(html).toContain("Routine · Every 6 months");
  });

  it("lists paused routines in their own quiet section with a Resume control", () => {
    const html = renderToStaticMarkup(
      <ActionsSurface
        active={[]}
        areas={[HOME]}
        paused={[
          actionView({
            id: "p1",
            status: "paused",
            isRoutine: true,
            recurrenceLabel: "Every week",
            surfaceState: "paused",
            surfaceLabel: "Paused",
          }),
        ]}
        resolved={[]}
        resolvedTruncated={false}
      />,
    );

    expect(html).toContain("Paused routines");
    expect(html).toContain("Resume");
    expect(html).toContain("Every week");
    // Indefinite micro-copy, contrasting a deferred Action's dated "Set aside until".
    expect(html).toContain("Resume anytime");
  });
});

// The chips drive a client-side filter over the same pure helper the surface uses;
// this pins the filter behavior the static render can't click through.
describe("area filter behavior (shared with the surface)", () => {
  const actions = [
    actionView({ id: "a1", areaId: "home-id" }),
    actionView({ id: "a2", areaId: "health-id" }),
  ];

  it("selecting an area narrows the active list; All restores it", () => {
    expect(filterActionsByArea(actions, "home-id").map((a) => a.id)).toEqual(["a1"]);
    expect(filterActionsByArea(actions, null)).toHaveLength(2);
  });
});
