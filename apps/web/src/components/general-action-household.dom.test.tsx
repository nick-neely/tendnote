// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
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
 * DOM behaviour for the Phase Eight household collaboration affordances on an
 * Action row (#383): what the row says about whose record it is, which controls
 * a collaborator is offered on someone else's errand versus the household's
 * chore, how a race is reported, and the two things that must never happen —
 * a rotation, and an alert a member did not ask for.
 */

vi.mock("@/app/actions/general-actions", () => ({
  archiveGeneralActionAction: vi.fn(),
  completeGeneralActionAction: vi.fn(),
  declineResponsibilityHolderReminderAction: vi.fn(),
  deferGeneralActionAction: vi.fn(),
  dismissGeneralActionAction: vi.fn(),
  editGeneralActionAction: vi.fn(),
  getResponsibilityHolderReminderOfferAction: vi.fn(),
  handGeneralActionToHouseholdAction: vi.fn(),
  listGeneralActionHistoryAction: vi.fn(),
  pauseGeneralActionAction: vi.fn(),
  promoteAssetHintAction: vi.fn(),
  reopenGeneralActionAction: vi.fn(),
  resumeGeneralActionAction: vi.fn(),
  setGeneralActionPeopleAction: vi.fn(),
  setGeneralActionVisibilityAction: vi.fn(),
  setResponsibilityHolderAction: vi.fn(),
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
  completeGeneralActionAction,
  declineResponsibilityHolderReminderAction,
  getResponsibilityHolderReminderOfferAction,
  setResponsibilityHolderAction,
} from "@/app/actions/general-actions";
import { ActionRow } from "@/components/general-action-row";

const VIEWER = "owner-1";
const PARTNER = "user-partner";
const MEMBERS = [{ userId: PARTNER, name: "Ana", email: "ana@example.com" }];

function householdChore(overrides: Parameters<typeof generalActionViewFixture>[0] = {}) {
  return generalActionViewFixture({
    ownership: "household_native",
    scope: "household",
    visibilityLabel: "Whole household",
    title: "Put the bins out",
    ...overrides,
  });
}

function renderRow(action: ReturnType<typeof generalActionViewFixture>) {
  const onUpdate = vi.fn();
  render(
    <ReversibleMutationProvider>
      <ActionRow
        action={action}
        areas={[]}
        onResolve={vi.fn()}
        onUpdate={onUpdate}
        shareableMembers={MEMBERS}
      />
    </ReversibleMutationProvider>,
  );
  return { onUpdate };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: /more/i }));
}

/** A Routine's progress control reads "Done for now" — it is coming back. */
function completeControl() {
  return screen.getByRole("button", { name: /done for now|^complete$/i });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("what the row says about whose record this is", () => {
  it("attributes the household's chore to the household, never to whoever typed it", async () => {
    renderRow(householdChore());

    expect(screen.getByText("Household")).toBeTruthy();
    // The storage key is a real user id and must never surface as an author.
    expect(screen.queryByText(/Shared by/)).toBeNull();
  });

  it("names the member who shared their own errand", () => {
    renderRow(
      generalActionViewFixture({
        owned: false,
        ownerUserId: PARTNER,
        scope: "household",
        title: "My dentist appointment",
      }),
    );

    expect(screen.getByText("Shared by Ana")).toBeTruthy();
  });

  it("says who is looking after it, and says nothing at all when nobody is", () => {
    const { unmount } = render(
      <ReversibleMutationProvider>
        <ActionRow
          action={householdChore({
            responsibilityHolderUserId: PARTNER,
            responsibilityHolderLabel: "Ana is looking after this",
          })}
          areas={[]}
          onResolve={vi.fn()}
          onUpdate={vi.fn()}
          shareableMembers={MEMBERS}
        />
      </ReversibleMutationProvider>,
    );
    expect(screen.getByText("Ana is looking after this")).toBeTruthy();
    unmount();

    renderRow(householdChore());
    // No holder is the ordinary state of a household chore, so the row is quiet
    // rather than reporting an absence.
    expect(screen.queryByText(/looking after/i)).toBeNull();
    expect(screen.queryByText(/nobody|no one has|unassigned/i)).toBeNull();
  });
});

describe("which controls a collaborator is offered", () => {
  it("narrows someone else's shared errand to the reversible progress actions", async () => {
    renderRow(
      generalActionViewFixture({
        owned: false,
        ownerUserId: PARTNER,
        scope: "household",
        isRoutine: true,
        recurrenceLabel: "Every week",
      }),
    );

    // "I picked up the milk" stays available to whoever can see it.
    expect(completeControl()).toBeTruthy();

    await openMenu();
    // Everything that re-authors or retires someone else's record is gone —
    // not disabled, gone, because it was never theirs to take.
    for (const label of [/^edit$/i, /archive/i, /dismiss/i, /set aside/i, /skip/i, /pause/i]) {
      expect(screen.queryByRole("menuitem", { name: label })).toBeNull();
    }
    // And a member-owned record has no holder to name.
    expect(screen.queryByRole("menuitem", { name: /looking after/i })).toBeNull();
  });

  it("gives every active member the same controls over the household's own chore", async () => {
    renderRow(householdChore({ isRoutine: true, recurrenceLabel: "Every week" }));

    await openMenu();
    for (const label of [/^edit$/i, /archive/i, /skip/i, /looking after/i]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
    // It is already everyone's, so there is no audience left to change and
    // nothing to hand over.
    expect(screen.queryByRole("menuitem", { name: /who can see/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /hand to the household/i })).toBeNull();
  });
});

describe("a progress action that arrived second", () => {
  it("reports what became of the occurrence without treating it as a failure", async () => {
    vi.mocked(completeGeneralActionAction).mockResolvedValue({
      ok: true,
      view: {
        ...householdChore({ isRoutine: true, recurrenceLabel: "Every week" }),
        reconciliation: {
          handledAs: "completed",
          handledByUserId: PARTNER,
          handledByName: "Ana",
          handledAtISO: "2026-08-11T09:00:00.000Z",
        },
      },
    } as never);

    renderRow(householdChore({ isRoutine: true, recurrenceLabel: "Every week" }));
    await userEvent.click(completeControl());

    // Announced politely rather than raised: it is news, not a failure.
    const note = await screen.findByText(/Ana already marked this done/);
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).not.toMatch(/fail|error|conflict|could not|couldn't/i);
  });

  it("fences the tap on the occurrence the member actually saw", async () => {
    vi.mocked(completeGeneralActionAction).mockResolvedValue({
      ok: true,
      view: householdChore({ occurrenceVersion: 4 }),
    } as never);

    renderRow(householdChore({ occurrenceVersion: 3 }));
    await userEvent.click(completeControl());

    await waitFor(() =>
      expect(completeGeneralActionAction).toHaveBeenCalledWith(
        expect.objectContaining({ expectedOccurrenceVersion: 3 }),
      ),
    );
  });
});

describe("the hand-off, and the rotation that never happens", () => {
  it("asks who has it next once an occurrence is settled, and lets that be declined", async () => {
    const settled = householdChore({
      isRoutine: true,
      recurrenceLabel: "Every week",
      responsibilityHolderUserId: VIEWER,
      responsibilityHolderLabel: "You're looking after this",
    });
    vi.mocked(completeGeneralActionAction).mockResolvedValue({ ok: true, view: settled } as never);

    renderRow(settled);
    await userEvent.click(completeControl());

    expect(await screen.findByText("Who's looking after this next?")).toBeTruthy();
    // One tap per candidate — a named person, never a "next" button, because
    // there is no sequence for a next to advance along.
    expect(screen.getByRole("button", { name: "Ana" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /next|rotate|swap turn/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /not now/i }));
    await waitFor(() => expect(screen.queryByText("Who's looking after this next?")).toBeNull());
    // Declining leaves the holder exactly as it stands.
    expect(setResponsibilityHolderAction).not.toHaveBeenCalled();
  });

  it("takes the outgoing member's own reminder only when they choose it themselves", async () => {
    const settled = householdChore({
      isRoutine: true,
      recurrenceLabel: "Every week",
      responsibilityHolderUserId: VIEWER,
      responsibilityHolderLabel: "You're looking after this",
      reminderSchedule: {
        kind: "relative",
        label: "On the day",
        leadMinutes: 0,
        localTime: null,
        timeZone: "America/Chicago",
      },
    });
    vi.mocked(completeGeneralActionAction).mockResolvedValue({ ok: true, view: settled } as never);
    vi.mocked(setResponsibilityHolderAction).mockResolvedValue({
      ok: true,
      view: settled,
    } as never);

    renderRow(settled);
    await userEvent.click(completeControl());
    await screen.findByText("Who's looking after this next?");

    await userEvent.click(screen.getByRole("checkbox", { name: /remove my reminder/i }));
    await userEvent.click(screen.getByRole("button", { name: "Ana" }));

    await waitFor(() =>
      expect(setResponsibilityHolderAction).toHaveBeenCalledWith(
        expect.objectContaining({
          holderUserId: PARTNER,
          handedOff: true,
          removeOutgoingReminder: true,
        }),
      ),
    );
  });
});

describe("the holder reminder offer", () => {
  it("asks the named member once, in their own surface, and never enrolls them", async () => {
    vi.mocked(getResponsibilityHolderReminderOfferAction).mockResolvedValue({
      ok: true,
      view: { offer: true },
    } as never);

    renderRow(
      householdChore({
        dueAtISO: "2026-08-11T00:00:00.000Z",
        dueAtDate: "2026-08-11",
        responsibilityHolderUserId: VIEWER,
        responsibilityHolderLabel: "You're looking after this",
      }),
    );

    // An invitation, not an alert: nothing is saved until the member says so.
    expect(await screen.findByText(/Want a reminder on your own devices\?/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /no thanks/i }));

    await waitFor(() =>
      expect(declineResponsibilityHolderReminderAction).toHaveBeenCalledWith(
        expect.objectContaining({ generalActionId: expect.any(String) }),
      ),
    );
    expect(screen.queryByText(/Want a reminder on your own devices\?/)).toBeNull();
  });

  it("never offers a member a reminder about a record that names somebody else", async () => {
    vi.mocked(getResponsibilityHolderReminderOfferAction).mockResolvedValue({
      ok: true,
      view: { offer: true },
    } as never);

    renderRow(
      householdChore({
        dueAtISO: "2026-08-11T00:00:00.000Z",
        dueAtDate: "2026-08-11",
        responsibilityHolderUserId: PARTNER,
        responsibilityHolderLabel: "Ana is looking after this",
      }),
    );

    // Even with the server saying yes, this viewer is not the named member, so
    // the offer is not theirs to see — and the ask is never even made.
    await waitFor(() => expect(screen.getByText("Ana is looking after this")).toBeTruthy());
    expect(screen.queryByText(/Want a reminder on your own devices\?/)).toBeNull();
    expect(getResponsibilityHolderReminderOfferAction).not.toHaveBeenCalled();
  });
});
