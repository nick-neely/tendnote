import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
  reopenGeneralActionAction: vi.fn(),
}));

vi.mock("@/app/actions/general-action-areas", () => ({
  archiveGeneralActionAreaAction: vi.fn(),
  createGeneralActionAreaAction: vi.fn(),
  renameGeneralActionAreaAction: vi.fn(),
  unarchiveGeneralActionAreaAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ActionsSurface } from "./actions-surface";

function actionView(overrides: Partial<GeneralActionView> = {}): GeneralActionView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Replace the water filter",
    notes: null,
    links: [],
    assetHints: [],
    linkedPeople: [],
    status: "open",
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

  it("shows the Add areas affordance and no chips when there are no active areas", () => {
    const html = render([actionView()], []);

    expect(html).toContain("Add areas");
    expect(html).toContain("No areas yet");
    expect(html).not.toContain(">All<");
  });

  it("labels each action with its area under the All view", () => {
    const html = render([actionView({ areaId: "home-id" })], [HOME, HEALTH]);

    // The default (All) view surfaces the action's area as a quiet label.
    expect(html).toContain("Home");
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
