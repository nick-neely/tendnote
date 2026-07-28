// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const createSavedItemAction = vi.fn();
const archiveSavedItemAction = vi.fn();
const reopenSavedItemAction = vi.fn();
const resolveSavedItemAction = vi.fn();
const promoteSavedItemToGeneralActionAction = vi.fn();
const editSavedItemAction = vi.fn();
const getSavedItemSourceDeletionImpactAction = vi.fn();
const deleteUniqueSavedItemSourceAction = vi.fn();
const saveReminderAction = vi.fn();

vi.mock("@/app/actions/saved-items", () => ({
  createSavedItemAction: (...args: unknown[]) => createSavedItemAction(...args),
  archiveSavedItemAction: (...args: unknown[]) => archiveSavedItemAction(...args),
  reopenSavedItemAction: (...args: unknown[]) => reopenSavedItemAction(...args),
  resolveSavedItemAction: (...args: unknown[]) => resolveSavedItemAction(...args),
  promoteSavedItemToGeneralActionAction: (...args: unknown[]) =>
    promoteSavedItemToGeneralActionAction(...args),
  editSavedItemAction: (...args: unknown[]) => editSavedItemAction(...args),
  getSavedItemSourceDeletionImpactAction: (...args: unknown[]) =>
    getSavedItemSourceDeletionImpactAction(...args),
  deleteUniqueSavedItemSourceAction: (...args: unknown[]) =>
    deleteUniqueSavedItemSourceAction(...args),
}));

vi.mock("@/app/actions/reminders", () => ({
  clearReminderAction: vi.fn(),
  registerReminderInstallationAction: vi.fn(),
  saveReminderAction: (...args: unknown[]) => saveReminderAction(...args),
  setReminderOptInDecisionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { SavedItemView } from "@/lib/saved-item-view";
import { SavedItemsSurface } from "./saved-items-surface";

function fixture(overrides: Partial<SavedItemView> = {}): SavedItemView {
  return {
    id: "saved-1",
    revision: "2026-07-01T12:00:00.000Z",
    kind: "note",
    kindLabel: "Note",
    title: "Filter measurements",
    content: "Eight inches long",
    url: null,
    status: "active",
    archived: false,
    ownerUserId: "owner-1",
    owned: true,
    bringBackAt: null,
    bringBackState: null,
    bringBackLabel: null,
    scope: "private",
    visibilityLabel: "Only me",
    sourceRecordId: "source-1",
    resolutionReason: null,
    outcomes: [],
    ...overrides,
  };
}

describe("SavedItemsSurface", () => {
  it("creates a private note through the fast capture form", async () => {
    const user = userEvent.setup();
    const created = fixture();
    createSavedItemAction.mockResolvedValue({ ok: true, view: created });
    render(<SavedItemsSurface items={[]} />);

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Filter measurements");
    await user.type(screen.getByRole("textbox", { name: "Details" }), "Eight inches long");
    await user.click(screen.getByRole("button", { name: "Save item" }));

    await waitFor(() =>
      expect(createSavedItemAction).toHaveBeenCalledWith({
        kind: "note",
        title: "Filter measurements",
        content: "Eight inches long",
        visibilityChoice: "only_me",
      }),
    );
    const title = await screen.findByText("Filter measurements");
    expect(title.closest("article")?.id).toBe("saved-item-saved-1");
  });

  it("does not confirm a Saved Item reminder whose selected alert time has passed", async () => {
    const user = userEvent.setup();
    const created = fixture({ bringBackAt: "2026-07-21T16:00:00.000Z" });
    createSavedItemAction.mockResolvedValue({ ok: true, view: created });
    saveReminderAction.mockResolvedValue({
      ok: true,
      view: {
        optIn: { state: "none", clientInstallationId: "browser-installation-1" },
        nextValidChoice: {
          label: "At the bring-back time",
          choice: { kind: "relative", leadMinutes: 0 },
        },
        schedule: {
          kind: "relative",
          localTime: null,
          leadMinutes: 1_440,
          timeZone: "America/Chicago",
          intendedAtISO: "2026-07-20T16:00:00.000Z",
        },
      },
    });
    render(<SavedItemsSurface items={[]} />);

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Filter measurements");
    await user.type(screen.getByLabelText("Bring back"), "2026-07-21T16:00");
    await user.click(screen.getByRole("checkbox", { name: "Remind me" }));
    await user.click(screen.getByRole("button", { name: "Save item" }));

    expect(await screen.findByText(/alert time has passed/i)).toBeDefined();
    expect(screen.queryByText(/Reminder at|Reminder one|Reminder at the/i)).toBeNull();
  });

  it("shows grounding and linked outcomes, and resolves an open question with a reason", async () => {
    const user = userEvent.setup();
    const question = fixture({
      kind: "open_question",
      kindLabel: "Open question",
      title: "Where should I buy the filter?",
      outcomes: [
        {
          destinationKind: "general_action",
          destinationRecordId: "action-1",
          label: "General Action",
        },
      ],
    });
    resolveSavedItemAction.mockResolvedValue({
      ok: true,
      view: { ...question, status: "archived", archived: true, resolutionReason: "Local store" },
    });
    getSavedItemSourceDeletionImpactAction.mockResolvedValue({
      ok: true,
      view: {
        sourceRecordId: "source-1",
        linkedSavedItemIds: ["saved-1"],
        linkedOutcomes: [{ destinationKind: "general_action", destinationRecordId: "action-1" }],
        linkedRecords: [{ recordKind: "memory", recordId: "memory-1" }],
        requiresImpactDisclosure: true,
      },
    });
    render(<SavedItemsSurface items={[question]} />);

    expect(screen.getByText("General Action")).toBeDefined();
    await user.click(screen.getByText("Source grounding"));
    expect(screen.getByText("source-1")).toBeDefined();
    expect(screen.getByText(/affect the linked outcome/i)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Check deletion impact" }));
    expect(await screen.findByText(/grounds 1 Saved Item and 1 linked outcome/i)).toBeDefined();

    await user.type(screen.getByRole("textbox", { name: "Resolution reason" }), "Local store");
    await user.click(screen.getByRole("button", { name: "Resolve question" }));
    await waitFor(() =>
      expect(resolveSavedItemAction).toHaveBeenCalledWith({
        savedItemId: "saved-1",
        reason: "Local store",
      }),
    );
  });

  it("promotes explicitly and archives or reopens through real lifecycle controls", async () => {
    const user = userEvent.setup();
    const item = fixture();
    promoteSavedItemToGeneralActionAction.mockResolvedValue({
      ok: true,
      view: { ...item, archived: true, status: "archived" },
    });
    render(<SavedItemsSurface items={[item]} />);

    await user.click(screen.getByRole("button", { name: "Make an action" }));
    await waitFor(() =>
      expect(promoteSavedItemToGeneralActionAction).toHaveBeenCalledWith({
        savedItemId: "saved-1",
      }),
    );
  });

  it("requires impact inspection and a second confirmation before deleting unique evidence", async () => {
    const user = userEvent.setup();
    getSavedItemSourceDeletionImpactAction.mockResolvedValue({
      ok: true,
      view: {
        sourceRecordId: "source-1",
        linkedSavedItemIds: ["saved-1"],
        linkedOutcomes: [],
        linkedRecords: [],
        requiresImpactDisclosure: false,
      },
    });
    deleteUniqueSavedItemSourceAction.mockResolvedValue({
      ok: true,
      view: {
        deletedSavedItemId: "saved-1",
        deletedSourceRecordId: "source-1",
      },
    });
    render(<SavedItemsSurface items={[fixture()]} />);

    await user.click(screen.getByText("Source grounding"));
    await user.click(screen.getByRole("button", { name: "Check deletion impact" }));
    await user.click(await screen.findByRole("button", { name: "Delete this source permanently" }));
    expect(deleteUniqueSavedItemSourceAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() =>
      expect(deleteUniqueSavedItemSourceAction).toHaveBeenCalledWith({ savedItemId: "saved-1" }),
    );
    expect(screen.queryByText("Filter measurements")).toBeNull();
  });
});
