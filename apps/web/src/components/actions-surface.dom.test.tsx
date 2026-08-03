// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";
import type { GeneralActionView } from "@/lib/general-action-view";
import { act, fireEvent, render, screen, setMatchMedia, userEvent, waitFor } from "@/test/dom";

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
  // The secondary shelf fetches on open, so opening a section in a test hits these.
  // They reconcile additively, so an empty result never clears the fixtures.
  getActionComposerOptionsAction: vi.fn(async () => ({
    ok: true as const,
    view: { people: [], shareableMembers: [] },
  })),
  getActionSecondaryLedgerViewsAction: vi.fn(async () => ({
    ok: true as const,
    view: { paused: [], resolved: [] },
  })),
  getSuggestedActionViewsAction: vi.fn(async () => ({
    ok: true as const,
    view: { suggested: [] },
  })),
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

import {
  completeGeneralActionAction,
  getActionSecondaryLedgerViewsAction,
  reopenGeneralActionAction,
} from "@/app/actions/general-actions";
import { useDeepLinkHighlight } from "@/lib/use-deep-link-highlight";
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
  it("does not resurrect a stale resolved row after a newer reopen acknowledgement", async () => {
    const user = userEvent.setup();
    const resolved = generalActionViewFixture({
      id: "revisioned-action",
      revision: "1",
      status: "completed",
      title: "Renew the registration",
    });
    const reopened = { ...resolved, revision: "3", status: "open" as const };
    vi.mocked(reopenGeneralActionAction).mockResolvedValue({ ok: true, view: reopened });
    const rendered = render(<ActionsSurface active={[]} areas={[]} resolved={[resolved]} />);

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await screen.findByRole("button", { name: "Undo Reopen" });

    rendered.rerender(
      <ActionsSurface active={[]} areas={[]} resolved={[{ ...resolved, revision: "2" }]} />,
    );

    expect(screen.getAllByText("Renew the registration")).toHaveLength(1);
    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("rejects a stale inverse callback that targets the old destination", async () => {
    const user = userEvent.setup();
    const resolved = generalActionViewFixture({
      id: "late-inverse-action",
      revision: "1",
      status: "completed",
      title: "Renew the registration",
    });
    const reopened = { ...resolved, revision: "3", status: "open" as const };
    vi.mocked(reopenGeneralActionAction).mockResolvedValue({ ok: true, view: reopened });
    vi.mocked(completeGeneralActionAction).mockResolvedValue({
      ok: true,
      view: { ...resolved, revision: "2" },
    });
    render(<ActionsSurface active={[]} areas={[]} resolved={[resolved]} />);

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await user.click(await screen.findByRole("button", { name: "Undo Reopen" }));

    await waitFor(() =>
      expect(completeGeneralActionAction).toHaveBeenCalledWith({
        generalActionId: resolved.id,
      }),
    );
    expect(screen.getByRole("button", { name: "Complete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
    expect(screen.getAllByText("Renew the registration")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain(
      "This record changed elsewhere. Refresh and try again.",
    );
    expect(screen.getByRole("status").textContent).not.toContain("Action restored.");
  });

  it("restores a failed reopen to its original resolved-list position", async () => {
    const user = userEvent.setup();
    const resolved = ["First", "Middle", "Last"].map((title, index) =>
      generalActionViewFixture({
        id: `resolved-${index}`,
        revision: "1",
        status: "completed",
        title,
      }),
    );
    vi.mocked(reopenGeneralActionAction).mockResolvedValue({
      ok: false,
      error: "Unable to reopen this action.",
    });
    render(<ActionsSurface active={[]} areas={[]} resolved={resolved} />);

    const middleReopen = screen.getAllByRole("button", { name: "Reopen" })[1];
    if (!middleReopen) throw new Error("expected the middle resolved action");
    await user.click(middleReopen);
    await screen.findByText("Unable to reopen this action.");

    expect(
      Array.from(document.querySelectorAll("article[id^='action-']")).map((row) => row.id),
    ).toEqual(resolved.map((action) => `action-${action.id}`));
  });

  it("expires historical displacement before a later lifecycle mutation", async () => {
    vi.useFakeTimers();
    try {
      const resolved = ["First", "Middle", "Last"].map((title, index) =>
        generalActionViewFixture({
          id: `sequential-${index}`,
          revision: "1",
          status: "completed",
          title,
        }),
      );
      const middle = resolved[1];
      if (!middle) throw new Error("expected a middle action");
      const reopened = { ...middle, revision: "2", status: "open" as const };
      vi.mocked(reopenGeneralActionAction).mockResolvedValue({ ok: true, view: reopened });
      vi.mocked(completeGeneralActionAction).mockResolvedValue({
        ok: true,
        view: { ...reopened, revision: "3", status: "completed" as const },
      });
      render(<ActionsSurface active={[]} areas={[]} resolved={resolved} />);

      const middleReopen = screen.getAllByRole("button", { name: "Reopen" })[1];
      if (!middleReopen) throw new Error("expected the middle resolved action");
      fireEvent.click(middleReopen);
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(5_000);
      });

      fireEvent.click(screen.getByRole("button", { name: "Complete" }));
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.runAllTimersAsync();
      });

      expect(
        Array.from(document.querySelectorAll("article[id^='action-']")).map((row) => row.id),
      ).toEqual([
        `action-${resolved[0]?.id}`,
        `action-${resolved[2]?.id}`,
        `action-${resolved[1]?.id}`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves focus to the page heading after the final active row leaves", async () => {
    vi.useFakeTimers();
    try {
      const action = generalActionViewFixture({
        id: "only-active-action",
        revision: "1",
        status: "open",
        title: "Only active action",
      });
      vi.mocked(completeGeneralActionAction).mockResolvedValue({
        ok: true,
        view: { ...action, revision: "2", status: "completed" },
      });
      render(
        <main>
          <h1>Actions</h1>
          <ActionsSurface active={[action]} areas={[]} resolved={[]} />
        </main>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Complete" }));
      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.runAllTimersAsync();
      });

      const heading = screen.getByRole("heading", { name: "Actions" });
      expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
      expect(document.activeElement).toBe(heading);

      // The completed action filed itself under the folded Resolved shelf rather than
      // vanishing; opening that shelf finds it, still reopenable.
      fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
      await act(async () => {
        await Promise.resolve();
        await vi.runAllTimersAsync();
      });
      expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the archive focus target on the archive control, not History", () => {
    render(
      <ActionsSurface
        active={[]}
        areas={[]}
        paused={[
          generalActionViewFixture({
            isRoutine: true,
            recurrence: { interval: 1, unit: "month" },
            recurrenceLabel: "Every month",
            status: "paused",
          }),
        ]}
        resolved={[]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Archive" }).getAttribute("data-action-control"),
    ).toBe("archive");
    expect(
      screen.getByRole("button", { name: "History" }).hasAttribute("data-action-control"),
    ).toBe(false);
  });

  it("narrows the active ledger to the selected Area, then restores it with All", async () => {
    const user = userEvent.setup();
    renderSurface([FIX_SINK, BOOK_DENTIST], [HOME, HEALTH]);

    // Action titles are unique and render only when their row is on the ledger, so a
    // title leaving the document is proof the filter dropped that row.
    expect(screen.getByText("Fix the kitchen sink")).toBeTruthy();
    expect(screen.getByText("Book the dentist")).toBeTruthy();

    // Selecting Health narrows the ledger to that Area's action only. The chips are a
    // single-select group (Radix ToggleGroup type="single"), so each is a radio.
    await user.click(screen.getByRole("radio", { name: "Health", checked: false }));
    expect(screen.getByText("Book the dentist")).toBeTruthy();
    expect(screen.queryByText("Fix the kitchen sink")).toBeNull();
    // The chosen chip reads as the current selection to AT.
    expect(screen.getByRole("radio", { name: "Health" }).getAttribute("aria-checked")).toBe("true");

    // All restores the full ledger.
    await user.click(screen.getByRole("radio", { name: "All" }));
    expect(screen.getByText("Fix the kitchen sink")).toBeTruthy();
    expect(screen.getByText("Book the dentist")).toBeTruthy();
  });

  it("shows a calm empty state for an Area with nothing, offering All to see everything", async () => {
    const user = userEvent.setup();
    renderSurface([FIX_SINK], [HOME, HEALTH]);

    await user.click(screen.getByRole("radio", { name: "Health", checked: false }));

    expect(screen.getByText(/Nothing in (Home|Health) right now\./)).toBeTruthy();
    // The empty state teaches the way back: its own "All" action, distinct from the
    // filter chip of the same name (which is a radio, not a button).
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Fix the kitchen sink")).toBeTruthy();
  });
});

describe("ActionsSurface deep link into the secondary shelf", () => {
  /**
   * The landing half of the deep link lives in the app shell, not in this surface, so the
   * harness pairs them the way the real page does: `useDeepLinkHighlight` above,
   * `ActionsSurface` below, talking through the reveal registry.
   */
  function DeepLinkedSurface({ active = [] }: { active?: GeneralActionView[] }) {
    useDeepLinkHighlight();
    return <ActionsSurface active={active} areas={[]} />;
  }

  it("opens the Resolved shelf, loads it, and highlights the deep-linked row", async () => {
    // `/actions#action-<id>` can name a resolved Action, whose row exists only once the
    // Resolved shelf is opened and the secondary read returns - so before this, the deep
    // link landed nowhere at all.
    const resolvedAction = generalActionViewFixture({
      id: "deep-linked-action",
      status: "completed",
      title: "Renew the registration",
    });
    vi.mocked(getActionSecondaryLedgerViewsAction).mockResolvedValueOnce({
      ok: true,
      view: { paused: [], resolved: [resolvedAction] },
    });
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    window.location.hash = "#action-deep-linked-action";

    try {
      render(<DeepLinkedSurface />);

      // The shelf the owner never touched is open, and the lazily fetched row is on screen.
      await screen.findByText("Renew the registration");
      expect(screen.getByRole("button", { name: "Resolved" }).getAttribute("aria-expanded")).toBe(
        "true",
      );

      const row = document.getElementById("action-deep-linked-action");
      await waitFor(() => {
        expect(row?.scrollIntoView).toHaveBeenCalled();
        expect(document.activeElement).toBe(row);
      });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      window.location.hash = "";
    }
  });

  it("leaves the shelves folded when the deep link names no action on this surface", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    window.location.hash = "#action-nothing-here";

    try {
      render(<DeepLinkedSurface active={[FIX_SINK]} />);

      // The claim still runs the one read that could hold the row; finding nothing is a
      // quiet no-op, not an opened shelf or an error.
      await waitFor(() => expect(getActionSecondaryLedgerViewsAction).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Resolved" }).getAttribute("aria-expanded")).toBe(
          "false",
        ),
      );
      expect(
        screen.getByRole("button", { name: "Paused routines" }).getAttribute("aria-expanded"),
      ).toBe("false");
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      window.location.hash = "";
    }
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
    expect(screen.getByRole("radiogroup", { name: "Filter by area" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage areas" })).toBeTruthy();

    // The filter bar is one row at every width: the chips scroll sideways rather
    // than wrapping into extra rows of chrome above the ledger, and the manage
    // control keeps its icon while its label goes screen-reader-only on a phone.
    const filterBar = document.querySelector("[data-slot=action-filter-bar]");
    expect(filterBar?.className).not.toContain("flex-col");
    expect(filterBar?.querySelector(".overflow-x-auto")).toBeTruthy();

    // Controls stay operable (not just present) at this width — the filter still works.
    await user.click(screen.getByRole("radio", { name: "Health", checked: false }));
    expect(screen.queryByText("Fix the kitchen sink")).toBeNull();
  });
});
