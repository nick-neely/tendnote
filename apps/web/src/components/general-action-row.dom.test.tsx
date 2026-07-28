// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import type { GeneralActionView } from "@/lib/general-action-view";
import { ReversibleMutationProvider } from "@/lib/reversible-mutation";
import { render, screen, userEvent, waitFor } from "@/test/dom";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

/**
 * DOM behavior for the action↔asset bridge on an Action row (#199): a bare hint
 * chip carries the owner's quiet "Track" entry point, promoting flips it to an
 * in-review state through the review gate (never a silent durable write), and a
 * hint that became a real Asset renders as a deep link into its profile.
 */

vi.mock("@/app/actions/general-actions", () => ({
  archiveGeneralActionAction: vi.fn(),
  completeGeneralActionAction: vi.fn(),
  deferGeneralActionAction: vi.fn(),
  dismissGeneralActionAction: vi.fn(),
  editGeneralActionAction: vi.fn(),
  listGeneralActionHistoryAction: vi.fn(),
  pauseGeneralActionAction: vi.fn(),
  promoteAssetHintAction: vi.fn(),
  reopenGeneralActionAction: vi.fn(),
  resumeGeneralActionAction: vi.fn(),
  setGeneralActionPeopleAction: vi.fn(),
  setGeneralActionVisibilityAction: vi.fn(),
  skipGeneralActionOccurrenceAction: vi.fn(),
  undeferGeneralActionAction: vi.fn(),
  undoRoutineOccurrenceAction: vi.fn(),
}));

vi.mock("@/app/actions/reminders", () => ({
  clearReminderAction: vi.fn(),
  clearGeneralActionReminderAction: vi.fn(),
  registerReminderInstallationAction: vi.fn(),
  saveGeneralActionReminderAction: vi.fn(),
  saveReminderAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

vi.mock("next/link", () => import("@/test/next-link-mock"));

import {
  archiveGeneralActionAction,
  completeGeneralActionAction,
  deferGeneralActionAction,
  promoteAssetHintAction,
  reopenGeneralActionAction,
  skipGeneralActionOccurrenceAction,
  undeferGeneralActionAction,
  undoRoutineOccurrenceAction,
} from "@/app/actions/general-actions";
import { ActionRow } from "./general-action-row";

const HINT = "refrigerator water filter";

function renderRow(action: GeneralActionView, onUpdate = vi.fn()) {
  render(
    <ReversibleMutationProvider>
      <ActionRow action={action} areas={[]} onResolve={vi.fn()} onUpdate={onUpdate} />
    </ReversibleMutationProvider>,
  );
  return onUpdate;
}

function actionWithHint(overrides: Partial<GeneralActionView> = {}): GeneralActionView {
  return generalActionViewFixture({
    title: "Replace the refrigerator water filter",
    assetHints: [{ label: HINT }],
    ...overrides,
  });
}

describe("asset hints on an Action row (#199)", () => {
  it("offers the owner a Track entry point beside an unpromoted hint", () => {
    renderRow(actionWithHint());

    expect(screen.getByText(HINT)).toBeTruthy();
    expect(screen.getByRole("button", { name: `Track "${HINT}" as an asset` })).toBeTruthy();
  });

  it("never offers Track on a row the viewer doesn't own", () => {
    renderRow(actionWithHint({ owned: false, ownerUserId: "someone-else" }));

    expect(screen.getByText(HINT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Track "${HINT}" as an asset` })).toBeNull();
  });

  it("promotes through the review gate and hands the refreshed view to the row", async () => {
    const user = userEvent.setup();
    const promoted = actionWithHint({
      linkedAssets: [
        {
          assetId: "22222222-2222-2222-2222-222222222222",
          name: HINT,
          kind: "appliance",
          kindLabel: "Appliance",
          hintLabel: HINT,
          pending: true,
        },
      ],
    });
    vi.mocked(promoteAssetHintAction).mockResolvedValue({ ok: true, view: promoted });
    const onUpdate = renderRow(actionWithHint());

    await user.click(screen.getByRole("button", { name: `Track "${HINT}" as an asset` }));

    await waitFor(() => {
      expect(promoteAssetHintAction).toHaveBeenCalledWith({
        generalActionId: promoted.id,
        hintLabel: HINT,
      });
      expect(onUpdate).toHaveBeenCalledWith(promoted);
    });
  });

  it("shows a curated validation message inline when promotion is refused", async () => {
    const user = userEvent.setup();
    vi.mocked(promoteAssetHintAction).mockResolvedValue({
      ok: false,
      error: "That hint isn't on this action anymore.",
    });
    renderRow(actionWithHint());

    await user.click(screen.getByRole("button", { name: `Track "${HINT}" as an asset` }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("That hint isn't on this action anymore.")).toBeTruthy();
  });

  it("renders a pending promotion as a quiet in-review chip with no Track button", () => {
    renderRow(
      actionWithHint({
        linkedAssets: [
          {
            assetId: "22222222-2222-2222-2222-222222222222",
            name: HINT,
            kind: "appliance",
            kindLabel: "Appliance",
            hintLabel: HINT,
            pending: true,
          },
        ],
      }),
    );

    expect(screen.getByText("· in review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Track "${HINT}" as an asset` })).toBeNull();
  });

  it("renders an accepted asset as a chip deep-linking into its profile", () => {
    renderRow(
      actionWithHint({
        linkedAssets: [
          {
            assetId: "22222222-2222-2222-2222-222222222222",
            name: "Refrigerator water filter",
            kind: "appliance",
            kindLabel: "Appliance",
            hintLabel: HINT,
            pending: false,
          },
        ],
      }),
    );

    const chip = screen.getByRole("link", { name: /Refrigerator water filter/ });
    expect(chip.getAttribute("href")).toBe("/assets/22222222-2222-2222-2222-222222222222");
    // The hint's plain read-only chip is replaced by the linked one — no duplicate label.
    expect(screen.queryByRole("button", { name: `Track "${HINT}" as an asset` })).toBeNull();
  });
});

describe("Routine occurrence lifecycle", () => {
  it("waits for the server-owned next occurrence instead of projecting a date", async () => {
    const user = userEvent.setup();
    const action = actionWithHint({
      isRoutine: true,
      recurrence: { interval: 1, unit: "week" },
      recurrenceLabel: "Every week",
      dueAtISO: "2026-08-14T00:00:00.000Z",
      dueAtDate: "2026-08-14",
    });
    const next = { ...action, dueAtISO: "2026-08-21T00:00:00.000Z", dueAtDate: "2026-08-21" };
    let settle: ((value: { ok: true; view: GeneralActionView }) => void) | undefined;
    vi.mocked(skipGeneralActionOccurrenceAction).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const onUpdate = renderRow(action);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Skip this occurrence" }));

    expect(onUpdate).not.toHaveBeenCalled();
    settle?.({ ok: true, view: next });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(next));
  });

  it("skips the current occurrence and updates the row to the next one", async () => {
    const user = userEvent.setup();
    const next = actionWithHint({
      isRoutine: true,
      recurrence: { interval: 1, unit: "week" },
      recurrenceLabel: "Every week",
      dueAtISO: "2026-08-21T00:00:00.000Z",
      dueAtDate: "2026-08-21",
    });
    vi.mocked(skipGeneralActionOccurrenceAction).mockResolvedValue({ ok: true, view: next });
    const onUpdate = renderRow(
      actionWithHint({
        isRoutine: true,
        recurrence: { interval: 1, unit: "week" },
        recurrenceLabel: "Every week",
        dueAtISO: "2026-08-14T00:00:00.000Z",
        dueAtDate: "2026-08-14",
      }),
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Skip this occurrence" }));

    await waitFor(() =>
      expect(skipGeneralActionOccurrenceAction).toHaveBeenCalledWith({
        generalActionId: "11111111-1111-1111-1111-111111111111",
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith(next);
    expect(await screen.findByText(/Skipped · next/)).toBeDefined();
  });

  it("serializes an authoritative Undo for a skipped occurrence", async () => {
    const user = userEvent.setup();
    const action = actionWithHint({
      isRoutine: true,
      recurrence: { interval: 1, unit: "week" },
      recurrenceLabel: "Every week",
      dueAtISO: "2026-08-14T00:00:00.000Z",
      dueAtDate: "2026-08-14",
    });
    const next = { ...action, dueAtISO: "2026-08-21T00:00:00.000Z", dueAtDate: "2026-08-21" };
    vi.mocked(skipGeneralActionOccurrenceAction).mockResolvedValue({ ok: true, view: next });
    vi.mocked(undoRoutineOccurrenceAction).mockResolvedValue({ ok: true, view: action });
    renderRow(action);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Skip this occurrence" }));
    await user.click(screen.getByRole("button", { name: "Undo Skip" }));

    await waitFor(() =>
      expect(undoRoutineOccurrenceAction).toHaveBeenCalledWith({
        expectedDueAt: "2026-08-21T00:00:00.000Z",
        generalActionId: action.id,
        restoreDueAt: "2026-08-14T00:00:00.000Z",
      }),
    );
  });
});

describe("reversible Action lifecycle acknowledgement", () => {
  it("keeps deferred Action Undo visible while the original command is in flight", async () => {
    const user = userEvent.setup();
    const action = actionWithHint({
      dueAtDate: "2026-08-14",
      dueAtISO: "2026-08-14T00:00:00.000Z",
    });
    let settle: ((value: { ok: true; view: GeneralActionView }) => void) | undefined;
    vi.mocked(deferGeneralActionAction).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    vi.mocked(undeferGeneralActionAction).mockResolvedValue({ ok: true, view: action });
    renderRow(action);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Set aside" }));
    const date = screen.getByLabelText("Set aside until");
    await user.clear(date);
    await user.type(date, "2026-08-21");
    await user.click(screen.getByRole("button", { name: "Set aside" }));
    await user.click(screen.getByRole("button", { name: "Undo set aside" }));

    settle?.({
      ok: true,
      view: { ...action, status: "deferred", deferUntilDate: "2026-08-21" },
    });

    await waitFor(() =>
      expect(undeferGeneralActionAction).toHaveBeenCalledWith({ generalActionId: action.id }),
    );
  });

  it("projects a one-time completion before the authoritative response and keeps it busy", async () => {
    const user = userEvent.setup();
    let settle: ((value: { ok: true; view: GeneralActionView }) => void) | undefined;
    vi.mocked(completeGeneralActionAction).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const action = actionWithHint({ isRoutine: false, recurrence: null });
    renderRow(action);

    await user.click(screen.getByRole("button", { name: "Complete" }));

    const row = document.getElementById(`action-${action.id}`);
    expect(row?.dataset.leaving).toBe("true");
    expect(row?.getAttribute("aria-busy")).toBe("true");
    expect(row?.className).not.toContain("opacity-0");
    expect(screen.getAllByText("Updating action…").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Undo Complete" }));
    expect(screen.getByRole("button", { name: "Undoing…" })).toBeDefined();

    vi.mocked(reopenGeneralActionAction).mockResolvedValue({ ok: true, view: action });
    settle?.({ ok: true, view: action });

    await waitFor(() =>
      expect(reopenGeneralActionAction).toHaveBeenCalledWith({ generalActionId: action.id }),
    );
  });

  it("clears the optimistic Undo and restores focus when the original command fails", async () => {
    const user = userEvent.setup();
    const action = actionWithHint({ isRoutine: false, recurrence: null });
    vi.mocked(completeGeneralActionAction).mockResolvedValue({
      ok: false,
      error: "That action is already complete.",
    });
    renderRow(action);

    const complete = screen.getByRole("button", { name: "Complete" });
    await user.click(complete);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo Complete" })).toBeNull());
    expect(document.activeElement).toBe(complete);
    expect(screen.getByText("That action is already complete.")).toBeDefined();
  });

  it("restores overflow focus to the stable trigger and permits retry after failure", async () => {
    const user = userEvent.setup();
    const action = actionWithHint({ isRoutine: false, recurrence: null });
    vi.mocked(archiveGeneralActionAction).mockResolvedValue({
      ok: false,
      error: "Unable to archive this action.",
    });
    renderRow(action);

    const overflow = screen.getByRole("button", { name: "More actions" });
    await user.click(overflow);
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));

    await screen.findByText("Unable to archive this action.");
    await waitFor(() => expect(document.activeElement).toBe(overflow));
    expect(overflow.hasAttribute("disabled")).toBe(false);
    expect(overflow.getAttribute("data-action-control")).toBe("overflow");
  });
});
