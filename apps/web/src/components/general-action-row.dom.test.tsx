// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import type { GeneralActionView } from "@/lib/general-action-view";
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
  setGeneralActionPeopleAction: vi.fn(),
  setGeneralActionVisibilityAction: vi.fn(),
  skipGeneralActionOccurrenceAction: vi.fn(),
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
  promoteAssetHintAction,
  skipGeneralActionOccurrenceAction,
} from "@/app/actions/general-actions";
import { ActionRow } from "./general-action-row";

const HINT = "refrigerator water filter";

function renderRow(action: GeneralActionView, onUpdate = vi.fn()) {
  render(<ActionRow action={action} areas={[]} onResolve={vi.fn()} onUpdate={onUpdate} />);
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
});
