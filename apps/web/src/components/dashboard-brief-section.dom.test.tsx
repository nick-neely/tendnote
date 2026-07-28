// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefItemView, BriefView } from "@/lib/brief-view";
import { render, screen, userEvent, waitFor } from "@/test/dom";

/**
 * Behaviour of the brief rail's actions, in a real DOM. The sibling
 * `dashboard-brief-section.test.tsx` pins what the section *renders*; this file pins
 * what its buttons *do* — which server action runs, what the surface says while it is
 * running, what it says when it fails, and which row leaves the list afterwards.
 */

const actions = vi.hoisted(() => ({
  dismissBriefItemAction: vi.fn(),
  snoozeBriefItemAction: vi.fn(),
  generateBriefAction: vi.fn(),
  acceptBriefFollowupAction: vi.fn(),
}));

vi.mock("@/app/actions/briefs", () => actions);

vi.mock("@/components/use-create-draft", () => ({
  useCreateDraft: () => ({ create: () => {}, pending: false, error: null }),
}));

// A row deep-links to its person through `next/link`, which reaches for an app-router
// context a bare client tree does not provide.
vi.mock("next/link", () => import("@/test/next-link-mock"));

import { DashboardBriefSection } from "./dashboard-brief-section";

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ITEM_ID = "22222222-2222-2222-2222-222222222222";
const success = <T,>(view: T) => ({ ok: true as const, view });

function itemView(overrides: Partial<BriefItemView> = {}): BriefItemView {
  return {
    id: ITEM_ID,
    kind: "due_followup",
    title: "Follow up with Mark",
    reason: "Reconnect about the move.",
    personId: "person-1",
    personName: "Mark",
    dueLabel: "Jun 27",
    dueState: "today",
    surfaceLabel: "Due today",
    isSensitive: false,
    isSuggestedFollowup: false,
    ...overrides,
  };
}

function briefView(overrides: Partial<BriefView> = {}): BriefView {
  return { id: "brief-1", cadence: "daily", summary: null, items: [itemView()], ...overrides };
}

function resetActions() {
  for (const action of Object.values(actions)) {
    action.mockReset();
  }
}

describe("DashboardBriefSection", () => {
  beforeEach(resetActions);

  it("generates a brief for the cadence on screen and says so while it runs", async () => {
    const user = userEvent.setup();
    let finish = () => {};
    actions.generateBriefAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(success(undefined));
        }),
    );
    render(<DashboardBriefSection brief={null} cadence="weekly" />);

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(actions.generateBriefAction).toHaveBeenCalledWith({ cadence: "weekly" });
    // The empty state stays put and names what is happening rather than going blank.
    const generating = screen.getByRole("button", { name: "Generating…" });
    expect(generating.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/No weekly review yet/)).toBeTruthy();

    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy());
  });

  it("keeps the generate action available and explains a brief that could not be built", async () => {
    const user = userEvent.setup();
    actions.generateBriefAction.mockRejectedValue(new Error("offline"));
    render(<DashboardBriefSection brief={null} cadence="daily" />);

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't generate the brief. Try again.",
    );
    expect(screen.getByRole("button", { name: "Generate" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows a curated product-budget message without exposing raw infrastructure errors", async () => {
    const user = userEvent.setup();
    actions.generateBriefAction.mockResolvedValue({
      ok: false,
      error: "You've reached a usage limit for this action. Please try again shortly.",
    });
    render(<DashboardBriefSection brief={null} cadence="daily" />);

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "You've reached a usage limit for this action. Please try again shortly.",
    );
  });

  it("refreshes an existing brief by regenerating the same cadence", async () => {
    const user = userEvent.setup();
    actions.generateBriefAction.mockResolvedValue(success(undefined));
    render(<DashboardBriefSection brief={briefView()} cadence="daily" />);

    await user.click(screen.getByRole("button", { name: "Refresh Today's brief" }));

    await waitFor(() =>
      expect(actions.generateBriefAction).toHaveBeenCalledWith({
        cadence: "daily",
        regenerate: true,
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a refresh that did not land and leaves the existing brief readable", async () => {
    const user = userEvent.setup();
    actions.generateBriefAction.mockRejectedValue(new Error("offline"));
    render(<DashboardBriefSection brief={briefView()} cadence="daily" />);

    await user.click(screen.getByRole("button", { name: "Refresh Today's brief" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't refresh the brief. Try again.",
    );
    expect(screen.getByText("Follow up with Mark")).toBeTruthy();
  });
});

describe("BriefItemRow", () => {
  beforeEach(resetActions);

  function twoItemBrief(): BriefView {
    return briefView({
      items: [
        itemView(),
        itemView({
          id: OTHER_ITEM_ID,
          title: "Check in with Mara",
          personId: "person-2",
          personName: "Mara",
        }),
      ],
    });
  }

  it("snoozes the row it belongs to and drops it from the brief", async () => {
    const user = userEvent.setup();
    actions.snoozeBriefItemAction.mockResolvedValue(success(undefined));
    render(<DashboardBriefSection brief={twoItemBrief()} cadence="daily" />);

    await user.click(screen.getByRole("button", { name: "Snooze brief item for Mark" }));

    expect(actions.snoozeBriefItemAction).toHaveBeenCalledWith({ briefItemId: ITEM_ID });
    await waitFor(() => expect(screen.queryByText("Follow up with Mark")).toBeNull());
    // Only the acted-on row leaves; the rest of the brief is untouched.
    expect(screen.getByText("Check in with Mara")).toBeTruthy();
  });

  it("dismisses the row it belongs to and drops it from the brief", async () => {
    const user = userEvent.setup();
    actions.dismissBriefItemAction.mockResolvedValue(success(undefined));
    render(<DashboardBriefSection brief={twoItemBrief()} cadence="daily" />);

    await user.click(screen.getByRole("button", { name: "Dismiss brief item for Mara" }));

    expect(actions.dismissBriefItemAction).toHaveBeenCalledWith({ briefItemId: OTHER_ITEM_ID });
    await waitFor(() => expect(screen.queryByText("Check in with Mara")).toBeNull());
    expect(screen.getByText("Follow up with Mark")).toBeTruthy();
  });

  it("keeps a row that failed to resolve, with a plain explanation on the row", async () => {
    const user = userEvent.setup();
    actions.dismissBriefItemAction.mockRejectedValue(new Error("offline"));
    render(<DashboardBriefSection brief={briefView()} cadence="daily" />);

    await user.click(screen.getByRole("button", { name: "Dismiss brief item for Mark" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "That didn't go through. Try again.",
    );
    expect(screen.getByText("Follow up with Mark")).toBeTruthy();
  });

  it("names every row action for the person it is about", () => {
    render(
      <DashboardBriefSection
        brief={briefView({
          items: [itemView({ personName: "Mara", isSuggestedFollowup: true })],
        })}
        cadence="daily"
      />,
    );

    expect(screen.getByRole("button", { name: "Snooze brief item for Mara" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss brief item for Mara" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft a message for Mara" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Accept suggested follow-up for Mara" }),
    ).toBeTruthy();
  });

  it("drops the name from those labels for an item that is about no one", () => {
    // A brief item is not always about a person; the labels take a person-free form
    // rather than degrading to "…for this".
    render(
      <DashboardBriefSection
        brief={briefView({
          items: [itemView({ personName: null, isSuggestedFollowup: true })],
        })}
        cadence="daily"
      />,
    );

    expect(screen.getByRole("button", { name: "Snooze this brief item" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss this brief item" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft a message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept this suggested follow-up" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /for this/i })).toBeNull();
  });
});
