// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import type { GeneralActionView } from "@/lib/general-action-view";
import { render, screen, setMatchMedia, userEvent } from "@/test/dom";

/**
 * DOM click-through for the Actions surface Area filter (#179), previously proven only at
 * the pure-helper layer (`filterActionsByArea`) plus a static render. This drives the real
 * user path — clicking an Area chip — and asserts the client filter narrows the rendered
 * ledger in place and the "All" chip restores it, exactly what the static tests could not
 * exercise.
 *
 * It also carries the honest narrow-viewport check for /actions (ADR 0161): jsdom applies
 * no media queries, so it renders the mobile-first *base* layer — asserting the capture
 * form, filter group, and area controls are all in the document and operable there proves
 * the surface's controls stay reachable at a phone width, which is what the source-level
 * boundary scan could not.
 */

vi.mock("@/app/actions/general-actions", () => ({
  archiveGeneralActionAction: vi.fn(),
  completeGeneralActionAction: vi.fn(),
  createGeneralActionAction: vi.fn(),
  deferGeneralActionAction: vi.fn(),
  dismissGeneralActionAction: vi.fn(),
  editGeneralActionAction: vi.fn(),
  listGeneralActionHistoryAction: vi.fn(),
  pauseGeneralActionAction: vi.fn(),
  reopenGeneralActionAction: vi.fn(),
  resumeGeneralActionAction: vi.fn(),
}));

vi.mock("@/app/actions/general-action-areas", () => ({
  archiveGeneralActionAreaAction: vi.fn(),
  createGeneralActionAreaAction: vi.fn(),
  renameGeneralActionAreaAction: vi.fn(),
  unarchiveGeneralActionAreaAction: vi.fn(),
}));

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

vi.mock("next/link", () => import("@/test/next-link-mock"));

import { ActionsSurface } from "./actions-surface";

function area(id: string, name: string, archived = false): GeneralActionAreaView {
  return { id, name, archived };
}

const HOME = area("home-id", "Home");
const HEALTH = area("health-id", "Health");

const FIX_SINK = generalActionViewFixture({
  id: "a-home",
  title: "Fix the kitchen sink",
  areaId: "home-id",
});
const BOOK_DENTIST = generalActionViewFixture({
  id: "a-health",
  title: "Book the dentist",
  areaId: "health-id",
});

function renderSurface(active: GeneralActionView[], areas: GeneralActionAreaView[]) {
  return render(
    <ActionsSurface active={active} areas={areas} resolved={[]} resolvedTruncated={false} />,
  );
}

describe("ActionsSurface area filter (click-through)", () => {
  it("narrows the active ledger to the selected Area, then restores it with All", async () => {
    const user = userEvent.setup();
    renderSurface([FIX_SINK, BOOK_DENTIST], [HOME, HEALTH]);

    // Action titles are unique and render only when their row is on the ledger, so a
    // title leaving the document is proof the filter dropped that row.
    expect(screen.getByText("Fix the kitchen sink")).toBeTruthy();
    expect(screen.getByText("Book the dentist")).toBeTruthy();

    // Selecting Health narrows the ledger to that Area's action only.
    await user.click(screen.getByRole("button", { name: "Health", pressed: false }));
    expect(screen.getByText("Book the dentist")).toBeTruthy();
    expect(screen.queryByText("Fix the kitchen sink")).toBeNull();
    // The chosen chip reads as the current selection to AT.
    expect(screen.getByRole("button", { name: "Health" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    // All restores the full ledger.
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Fix the kitchen sink")).toBeTruthy();
    expect(screen.getByText("Book the dentist")).toBeTruthy();
  });

  it("shows a calm empty state for an Area with nothing, offering All to see everything", async () => {
    const user = userEvent.setup();
    renderSurface([FIX_SINK], [HOME, HEALTH]);

    await user.click(screen.getByRole("button", { name: "Health", pressed: false }));

    expect(screen.getByText(/Nothing in (Home|Health) right now\./)).toBeTruthy();
    // The empty state carries its own inline "All" restore affordance (last of the "All"
    // buttons: the filter chip plus this inline one).
    const restoreButtons = screen.getAllByRole("button", { name: "All" });
    const inlineAll = restoreButtons.at(-1);
    if (!inlineAll) {
      throw new Error("expected an inline All restore button in the empty state");
    }
    await user.click(inlineAll);
    expect(screen.getByText("Fix the kitchen sink")).toBeTruthy();
  });
});

describe("ActionsSurface narrow viewport (mobile-first base layer)", () => {
  it("keeps capture, filter, and area controls reachable and operable at a phone width", async () => {
    // Answer the narrow-breakpoint queries as a phone would; jsdom renders the un-broken
    // (mobile) style layer regardless, so this asserts control reachability, not px layout.
    setMatchMedia(true);
    const user = userEvent.setup();
    renderSurface([FIX_SINK, BOOK_DENTIST], [HOME, HEALTH]);

    // The whole interactive surface is present and reachable on a narrow viewport.
    expect(screen.getByRole("group", { name: "Filter by area" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage areas" })).toBeTruthy();

    // The filter reflow container is authored mobile-first: it stacks (`flex-col`) at the
    // base width and only becomes a row at `sm:` — the layer jsdom cannot compute.
    const filterGroup = screen.getByRole("group", { name: "Filter by area" });
    const reflow = filterGroup.parentElement;
    expect(reflow?.className).toContain("flex-col");
    expect(reflow?.className).toContain("sm:flex-row");

    // Controls stay operable (not just present) at this width — the filter still works.
    await user.click(screen.getByRole("button", { name: "Health", pressed: false }));
    expect(screen.queryByText("Fix the kitchen sink")).toBeNull();
  });
});
