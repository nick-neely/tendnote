// @vitest-environment jsdom
import type {
  HouseholdHomeRecord,
  HouseholdHomeSectionView,
} from "@tendnote/domain/household-home";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";

vi.mock("next/link", () => import("@/test/next-link-mock"));
const routerRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
const completeRecord = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/household-home", () => ({
  completeHouseholdHomeRecordAction: completeRecord,
}));

import { HouseholdHomeSection } from "./household-home-section";

const CHORE_ID = "11111111-1111-1111-1111-111111111111";
const ERRAND_ID = "22222222-2222-2222-2222-222222222222";

function record(overrides: Partial<HouseholdHomeRecord> = {}): HouseholdHomeRecord {
  return {
    identity: `routine:${CHORE_ID}`,
    family: "routine",
    section: "needs_attention",
    pressing: true,
    record: { kind: "general_action", id: CHORE_ID, href: `/actions#action-${CHORE_ID}` },
    title: "Put the bins out",
    context: "Routine · every week",
    timing: { code: "due_today", explanation: "Due today." },
    scopeLabel: "Household",
    responsibility: "Mara is looking after this",
    progress: { kind: "complete_record", label: "Done for now", expectedOccurrenceVersion: 3 },
    at: new Date("2026-07-21T09:00:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function section(overrides: Partial<HouseholdHomeSectionView> = {}): HouseholdHomeSectionView {
  return {
    section: "needs_attention",
    heading: "Ready now",
    records: [record()],
    more: null,
    limitations: [],
    ...overrides,
  };
}

function view(records: HouseholdHomeRecord[]) {
  return {
    household: { id: "household-1", name: "Ash Lane" },
    needsAttention: section({ records }),
    comingUp: section({ section: "coming_up", heading: "Coming up", records: [] }),
    reconciliation: null,
  };
}

beforeEach(() => {
  routerRefresh.mockClear();
  completeRecord.mockReset();
});

describe("a Household home section", () => {
  it("states type, timing, ownership, and responsibility in text rather than colour", () => {
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    const row = within(screen.getByRole("listitem"));
    expect(row.getByText("Routine · every week")).toBeDefined();
    // Timing, ownership, and responsibility are three facts on one line rather
    // than three stacked ones: the reader is scanning a list, and a row that
    // towers is a list nobody glances at. All three stay written out.
    expect(row.getByText("Due today. · Household · Mara is looking after this")).toBeDefined();
    expect(row.getByRole("link", { name: "Put the bins out" }).getAttribute("href")).toBe(
      `/actions#action-${CHORE_ID}`,
    );
  });

  it("says nothing about responsibility when nobody is named", () => {
    render(
      <HouseholdHomeSection
        sectionKey="needsAttention"
        view={section({ records: [record({ responsibility: null })] })}
      />,
    );

    expect(screen.getByText("Due today. · Household")).toBeDefined();
    expect(screen.queryByText(/looking after/)).toBeNull();
  });

  it("offers a member's own shared record with its own attribution", () => {
    render(
      <HouseholdHomeSection
        sectionKey="needsAttention"
        view={section({
          records: [
            record({
              identity: `action:${ERRAND_ID}`,
              family: "action",
              context: "Action",
              title: "My dentist appointment",
              scopeLabel: "Shared by Nick",
              responsibility: null,
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Due today. · Shared by Nick")).toBeDefined();
  });

  it("uses semantic headings and a list, in one column", () => {
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    expect(screen.getByRole("heading", { level: 2, name: "Ready now" })).toBeDefined();
    expect(screen.getByRole("list")).toBeDefined();
  });

  it("carries the occurrence the row was rendered against into the completion", async () => {
    const user = userEvent.setup();
    completeRecord.mockResolvedValue({ ok: true, view: view([]) });
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    await user.click(screen.getByRole("button", { name: "Done for now: Put the bins out" }));

    await waitFor(() =>
      expect(completeRecord).toHaveBeenCalledWith({
        generalActionId: CHORE_ID,
        expectedOccurrenceVersion: 3,
      }),
    );
  });

  it("settles on the household's own state and lets the sibling section catch up", async () => {
    const user = userEvent.setup();
    completeRecord.mockResolvedValue({ ok: true, view: view([]) });
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    await user.click(screen.getByRole("button", { name: "Done for now: Put the bins out" }));

    await waitFor(() => expect(screen.queryByRole("listitem")).toBeNull());
    expect(routerRefresh).toHaveBeenCalled();
    expect(await screen.findByText("Put the bins out is done.")).toBeDefined();
  });

  it("says it is working while the change is in flight", async () => {
    const user = userEvent.setup();
    let settle: ((outcome: unknown) => void) | undefined;
    completeRecord.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    await user.click(screen.getByRole("button", { name: "Done for now: Put the bins out" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Updating Household…");
    settle?.({ ok: true, view: view([]) });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Put the bins out is done."),
    );
  });

  it("says plainly when another member got there first", async () => {
    const user = userEvent.setup();
    completeRecord.mockResolvedValue({
      ok: true,
      view: { ...view([]), reconciliation: "Ben already marked this done Jul 20." },
    });
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    await user.click(screen.getByRole("button", { name: "Done for now: Put the bins out" }));

    const settled = await screen.findByText("Ben already marked this done Jul 20.");
    expect(settled.getAttribute("role")).toBe("status");
  });

  /**
   * Settling a record destroys the control the member just pressed. A keyboard
   * or screen-reader user whose focus falls to the body has lost their place on
   * the page entirely, so it has to land somewhere deliberate.
   */
  it("moves focus to the next record when one is settled away", async () => {
    const user = userEvent.setup();
    const bins = record();
    const errand = record({
      identity: `action:${ERRAND_ID}`,
      family: "action",
      context: "Action",
      title: "Renew the parking permit",
      record: { kind: "general_action", id: ERRAND_ID, href: `/actions#action-${ERRAND_ID}` },
    });
    completeRecord.mockResolvedValue({
      ok: true,
      view: { ...view([errand]), needsAttention: section({ records: [errand] }) },
    });
    render(
      <HouseholdHomeSection
        sectionKey="needsAttention"
        view={section({ records: [bins, errand] })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Done for now: Put the bins out" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("link", { name: "Renew the parking permit" }),
      ),
    );
  });

  it("moves focus to the section heading when the last record is settled away", async () => {
    const user = userEvent.setup();
    completeRecord.mockResolvedValue({ ok: true, view: view([]) });
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    await user.click(screen.getByRole("button", { name: "Done for now: Put the bins out" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 2, name: "Ready now" }),
      ),
    );
  });

  it("leaves focus on the control when the change did not land", async () => {
    const user = userEvent.setup();
    completeRecord.mockResolvedValue({ ok: false, error: "That's no longer available." });
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    const control = screen.getByRole("button", { name: "Done for now: Put the bins out" });
    await user.click(control);

    await screen.findByRole("alert");
    expect(document.activeElement).toBe(control);
  });

  it("keeps the record and explains when the change did not land", async () => {
    const user = userEvent.setup();
    completeRecord.mockResolvedValue({ ok: false, error: "That's no longer available." });
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    await user.click(screen.getByRole("button", { name: "Done for now: Put the bins out" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That's no longer available.");
    expect(screen.getByRole("listitem")).toBeDefined();
  });

  it("offers only completion inline; every other decision is on the record", () => {
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section()} />);

    expect(
      screen.getAllByRole("button").map((control) => control.getAttribute("aria-label")),
    ).toEqual(["Done for now: Put the bins out"]);
  });

  it("points at the domain for the rest without counting what is left", () => {
    render(
      <HouseholdHomeSection
        sectionKey="comingUp"
        view={section({
          section: "coming_up",
          heading: "Coming up",
          more: { destinations: [{ family: "action", label: "Actions", href: "/actions" }] },
        })}
      />,
    );

    const more = screen.getByText(/The rest is in/);
    expect(more.textContent).not.toMatch(/\d/);
    expect(within(more).getByRole("link", { name: "Actions" }).getAttribute("href")).toBe(
      "/actions",
    );
  });

  it("teaches an empty section without reproaching the household", () => {
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section({ records: [] })} />);

    const empty = screen.getByText("Nothing is waiting on the household.");
    expect(empty).toBeDefined();
    expect(document.body.textContent).not.toMatch(/overdue|behind|missed|inbox|\bstreak\b/i);
  });

  it("points an empty section at the one thing that fills it", () => {
    render(<HouseholdHomeSection sectionKey="needsAttention" view={section({ records: [] })} />);

    expect(screen.getByText(/A shared Action or Routine shows up here/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Go to Actions" }).getAttribute("href")).toBe(
      "/actions",
    );
  });

  it("explains a family it could not read without emptying what it did read", () => {
    render(
      <HouseholdHomeSection
        sectionKey="needsAttention"
        view={section({
          limitations: [
            "Part of Household is temporarily unavailable. Your household's records are unchanged.",
          ],
        })}
      />,
    );

    expect(screen.getByRole("listitem")).toBeDefined();
    expect(screen.getByText(/Part of Household is temporarily unavailable/)).toBeDefined();
  });
});
