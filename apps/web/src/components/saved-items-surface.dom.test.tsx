// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toDateValue } from "@/components/ui/date-picker";
import { fireEvent, render, screen, userEvent, waitFor } from "@/test/dom";

// Radix's Select measures and scrolls its content on open; jsdom implements
// none of that.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
HTMLElement.prototype.scrollIntoView ??= vi.fn();
HTMLElement.prototype.hasPointerCapture ??= vi.fn();
HTMLElement.prototype.releasePointerCapture ??= vi.fn();

const createSavedItemAction = vi.fn();
const createHouseholdSavedItemAction = vi.fn();
const archiveSavedItemAction = vi.fn();
const archiveHouseholdSavedItemAction = vi.fn();
const reopenSavedItemAction = vi.fn();
const restoreHouseholdSavedItemAction = vi.fn();
const resolveSavedItemAction = vi.fn();
const resolveHouseholdSavedItemAction = vi.fn();
const promoteSavedItemToGeneralActionAction = vi.fn();
const promoteHouseholdSavedItemAction = vi.fn();
const editSavedItemAction = vi.fn();
const editHouseholdSavedItemAction = vi.fn();
const getHouseholdSavedItemViewAction = vi.fn();
const getSavedItemSourceDeletionImpactAction = vi.fn();
const deleteUniqueSavedItemSourceAction = vi.fn();
const saveReminderAction = vi.fn();

vi.mock("@/app/actions/saved-items", () => ({
  createSavedItemAction: (...args: unknown[]) => createSavedItemAction(...args),
  createHouseholdSavedItemAction: (...args: unknown[]) => createHouseholdSavedItemAction(...args),
  archiveSavedItemAction: (...args: unknown[]) => archiveSavedItemAction(...args),
  archiveHouseholdSavedItemAction: (...args: unknown[]) => archiveHouseholdSavedItemAction(...args),
  reopenSavedItemAction: (...args: unknown[]) => reopenSavedItemAction(...args),
  restoreHouseholdSavedItemAction: (...args: unknown[]) => restoreHouseholdSavedItemAction(...args),
  resolveSavedItemAction: (...args: unknown[]) => resolveSavedItemAction(...args),
  resolveHouseholdSavedItemAction: (...args: unknown[]) => resolveHouseholdSavedItemAction(...args),
  promoteSavedItemToGeneralActionAction: (...args: unknown[]) =>
    promoteSavedItemToGeneralActionAction(...args),
  promoteHouseholdSavedItemAction: (...args: unknown[]) => promoteHouseholdSavedItemAction(...args),
  editSavedItemAction: (...args: unknown[]) => editSavedItemAction(...args),
  editHouseholdSavedItemAction: (...args: unknown[]) => editHouseholdSavedItemAction(...args),
  getHouseholdSavedItemViewAction: (...args: unknown[]) => getHouseholdSavedItemViewAction(...args),
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

const MEMBERS = [{ userId: "member-2", name: "Ben", email: "ben@example.com" }];

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
    ownership: "member_owned",
    version: 1,
    owned: true,
    canEdit: true,
    canDeleteEvidence: true,
    bringBackAt: null,
    bringBackState: null,
    bringBackLabel: null,
    scope: "private",
    visibilityLabel: "Only me",
    createdByLabel: null,
    lastChangedByLabel: null,
    sourceRecordId: "source-1",
    resolutionReason: null,
    outcomes: [],
    ...overrides,
  };
}

/** A member-owned item somebody else shared with the viewer. */
function sharedByOther(overrides: Partial<SavedItemView> = {}): SavedItemView {
  return fixture({
    ownerUserId: "member-2",
    owned: false,
    canEdit: false,
    canDeleteEvidence: false,
    scope: "shared",
    visibilityLabel: "Shared by Ben",
    ...overrides,
  });
}

/** A Saved Item the Household Workspace owns, which every member may re-author. */
function householdNative(overrides: Partial<SavedItemView> = {}): SavedItemView {
  return fixture({
    ownerUserId: null,
    ownership: "household_native",
    owned: false,
    canEdit: true,
    canDeleteEvidence: false,
    scope: "household",
    visibilityLabel: "Household",
    createdByLabel: "Created by Ben",
    ...overrides,
  });
}

/** The day button for a `yyyy-mm-dd` date in the open calendar (portaled to body). */
function dayButton(date: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-day="${date}"] button`);
  if (!button) throw new Error(`no day button for ${date}`);
  return button;
}

/** The same day-of-month in whichever month the picker opens on, so nothing drifts with the clock. */
function dayThisMonth(day: number): string {
  const now = new Date();
  return toDateValue(new Date(now.getFullYear(), now.getMonth(), day));
}

// The action doubles live at module scope, so call history has to be cleared
// between tests for "was never called" to mean anything.
beforeEach(() => vi.clearAllMocks());

describe("SavedItemsSurface", () => {
  it("creates a private note through the fast capture form", async () => {
    const user = userEvent.setup();
    const created = fixture();
    createSavedItemAction.mockResolvedValue({ ok: true, view: created });
    render(<SavedItemsSurface items={[]} />);

    expect(screen.getByText("Nothing saved here yet.")).toBeDefined();
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

  it("switches kind through the Select, which reveals the link field", async () => {
    const user = userEvent.setup();
    createSavedItemAction.mockResolvedValue({
      ok: true,
      view: fixture({ kind: "link", kindLabel: "Link", url: "https://example.com/filter" }),
    });
    render(<SavedItemsSurface items={[]} />);

    expect(screen.queryByRole("textbox", { name: "Link URL" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Kind" }));
    await user.click(await screen.findByRole("option", { name: "Link" }));

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Filter spec");
    await user.type(
      await screen.findByRole("textbox", { name: "Link URL" }),
      "https://example.com/filter",
    );
    await user.click(screen.getByRole("button", { name: "Save item" }));

    await waitFor(() =>
      expect(createSavedItemAction).toHaveBeenCalledWith({
        kind: "link",
        title: "Filter spec",
        url: "https://example.com/filter",
        visibilityChoice: "only_me",
      }),
    );
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
    await user.click(screen.getByRole("combobox", { name: "Bring back" }));
    await user.click(dayButton(dayThisMonth(21)));
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "16:00" } });
    await user.click(screen.getByRole("checkbox", { name: "Remind me" }));
    await user.click(screen.getByRole("button", { name: "Save item" }));

    expect(await screen.findByText(/alert time has passed/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Use At the bring-back time/i })).toBeDefined();
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

  it("captures into the household only after the destination is deliberately chosen", async () => {
    const user = userEvent.setup();
    createHouseholdSavedItemAction.mockResolvedValue({
      ok: true,
      view: householdNative({ createdByLabel: null }),
    });
    render(<SavedItemsSurface hasHousehold items={[]} shareableMembers={MEMBERS} />);

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Filter measurements");
    await user.click(screen.getByRole("button", { name: "Where this goes" }));
    await user.click(await screen.findByRole("radio", { name: /Household/ }));
    expect(screen.getByText(/stays with the household if you leave/i)).toBeDefined();
    // A household capture has no audience to choose - the workspace is the audience.
    expect(screen.queryByRole("radio", { name: /Only me/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save item" }));

    await waitFor(() =>
      expect(createHouseholdSavedItemAction).toHaveBeenCalledWith({
        kind: "note",
        title: "Filter measurements",
      }),
    );
    expect(createSavedItemAction).not.toHaveBeenCalled();
  });

  it("offers no destination choice to a member with no Household Workspace", () => {
    render(<SavedItemsSurface items={[]} />);

    expect(screen.queryByRole("button", { name: "Where this goes" })).toBeNull();
  });

  it("renders another member's shared item read-only, with no disabled stand-ins", () => {
    render(<SavedItemsSurface items={[sharedByOther()]} shareableMembers={MEMBERS} />);

    expect(screen.getByText("Shared by Ben")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make an action" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check deletion impact" })).toBeNull();
  });

  it("gives every member the full control set on a household-native item", async () => {
    const user = userEvent.setup();
    const item = householdNative();
    archiveHouseholdSavedItemAction.mockResolvedValue({
      ok: true,
      view: { ...item, archived: true, status: "archived" },
    });
    render(<SavedItemsSurface hasHousehold items={[item]} shareableMembers={MEMBERS} />);

    expect(screen.getByText("Household")).toBeDefined();
    expect(screen.getByText("Created by Ben")).toBeDefined();
    // Archive is a workspace-owned item's removal path; nobody deletes its evidence.
    await user.click(screen.getByText("Source grounding"));
    expect(screen.queryByRole("button", { name: "Check deletion impact" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(archiveHouseholdSavedItemAction).toHaveBeenCalledWith({ savedItemId: "saved-1" }),
    );
    expect(archiveSavedItemAction).not.toHaveBeenCalled();
  });

  it("promotes a household-native item straight into a household Action, with no choice to make", async () => {
    const user = userEvent.setup();
    const item = householdNative();
    promoteHouseholdSavedItemAction.mockResolvedValue({
      ok: true,
      view: { ...item, archived: true, status: "archived" },
    });
    render(<SavedItemsSurface hasHousehold items={[item]} shareableMembers={MEMBERS} />);

    expect(screen.queryByRole("button", { name: "Make an action" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Make household Action" }));

    await waitFor(() =>
      expect(promoteHouseholdSavedItemAction).toHaveBeenCalledWith({ savedItemId: "saved-1" }),
    );
    expect(promoteSavedItemToGeneralActionAction).not.toHaveBeenCalled();
  });

  it("keeps the draft beside the current value when a household edit conflicts", async () => {
    const user = userEvent.setup();
    const item = householdNative({ version: 3 });
    editHouseholdSavedItemAction.mockResolvedValue({
      ok: false,
      error: "Someone else changed this while you were writing. Your draft is kept below.",
      savedItemConflict: {
        savedItemId: "saved-1",
        version: 4,
        title: "Filter measurements, revised",
        content: "Ten inches long",
        url: null,
        bringBackAt: null,
        status: "active",
        lastActorUserId: "member-2",
        updatedAt: "2026-07-02T12:00:00.000Z",
      },
    });
    render(<SavedItemsSurface hasHousehold items={[item]} shareableMembers={MEMBERS} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox", { name: "Edit title" }));
    await user.type(screen.getByRole("textbox", { name: "Edit title" }), "Filter measurements v2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(editHouseholdSavedItemAction).toHaveBeenCalledWith({
        savedItemId: "saved-1",
        title: "Filter measurements v2",
        content: "Eight inches long",
        bringBackAt: null,
        expectedVersion: 3,
      }),
    );
    expect(
      await screen.findByText(/Someone else changed this while you were writing/),
    ).toBeDefined();
    expect(screen.getByText("Filter measurements, revised")).toBeDefined();
    expect(screen.getByText("Last changed by Ben")).toBeDefined();
    // The draft is kept, and an ordinary Save is replaced by the two answers.
    expect((screen.getByRole("textbox", { name: "Edit title" }) as HTMLInputElement).value).toBe(
      "Filter measurements v2",
    );
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();

    editHouseholdSavedItemAction.mockResolvedValue({
      ok: true,
      view: { ...item, title: "Filter measurements v2", revision: "2026-07-03T12:00:00.000Z" },
    });
    await user.click(screen.getByRole("button", { name: "Keep mine" }));

    await waitFor(() =>
      expect(editHouseholdSavedItemAction).toHaveBeenLastCalledWith({
        savedItemId: "saved-1",
        title: "Filter measurements v2",
        content: "Eight inches long",
        bringBackAt: null,
      }),
    );
    expect(await screen.findByText("Filter measurements v2")).toBeDefined();
  });

  it("adopts the stored value from the server when the member takes theirs", async () => {
    const user = userEvent.setup();
    const item = householdNative({ version: 3 });
    editHouseholdSavedItemAction.mockResolvedValue({
      ok: false,
      error: "Someone else changed this while you were writing. Your draft is kept below.",
      savedItemConflict: {
        savedItemId: "saved-1",
        version: 4,
        title: "Filter measurements, revised",
        content: "Ten inches long",
        url: null,
        bringBackAt: null,
        status: "active",
        lastActorUserId: "member-2",
        updatedAt: "2026-07-02T12:00:00.000Z",
      },
    });
    getHouseholdSavedItemViewAction.mockResolvedValue({
      ok: true,
      view: householdNative({
        version: 4,
        title: "Filter measurements, revised",
        content: "Ten inches long",
        revision: "2026-07-02T12:00:00.000Z",
        lastChangedByLabel: "Last changed by Ben",
      }),
    });
    render(<SavedItemsSurface hasHousehold items={[item]} shareableMembers={MEMBERS} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByRole("textbox", { name: "Edit title" }));
    await user.type(screen.getByRole("textbox", { name: "Edit title" }), "Filter measurements v2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(await screen.findByRole("button", { name: "Take theirs" }));

    await waitFor(() =>
      expect(getHouseholdSavedItemViewAction).toHaveBeenCalledWith({ savedItemId: "saved-1" }),
    );
    expect(await screen.findByText("Filter measurements, revised")).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Edit title" })).toBeNull();
  });

  it("requires a stated, confirmed hand-off before an Action becomes the household's", async () => {
    const user = userEvent.setup();
    const item = fixture({ scope: "household", visibilityLabel: "Home" });
    promoteSavedItemToGeneralActionAction.mockResolvedValue({
      ok: true,
      view: { ...item, archived: true, status: "archived" },
    });
    render(<SavedItemsSurface hasHousehold items={[item]} shareableMembers={MEMBERS} />);

    await user.click(screen.getByRole("button", { name: "Make household Action" }));
    expect(promoteSavedItemToGeneralActionAction).not.toHaveBeenCalled();
    expect(screen.getByText(/no way to take it back/i)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Make it the household's" }));

    await waitFor(() =>
      expect(promoteSavedItemToGeneralActionAction).toHaveBeenCalledWith({
        savedItemId: "saved-1",
        destination: "household_native",
      }),
    );
  });

  it("keeps the household hand-off away from a private item that has no workspace", () => {
    render(<SavedItemsSurface hasHousehold items={[fixture()]} shareableMembers={MEMBERS} />);

    expect(screen.getByRole("button", { name: "Make an action" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Make household Action" })).toBeNull();
  });
});
