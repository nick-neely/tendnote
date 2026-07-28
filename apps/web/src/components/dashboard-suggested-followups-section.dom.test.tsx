// @vitest-environment jsdom
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";
import { fireEvent, render, screen, userEvent } from "@/test/dom";

const actions = vi.hoisted(() => ({
  accept: vi.fn(),
  dismiss: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@/app/actions/suggested-followups", () => ({
  acceptSuggestedFollowupAction: actions.accept,
  dismissSuggestedFollowupAction: actions.dismiss,
  restoreDismissedSuggestedFollowupAction: actions.restore,
}));
vi.mock("next/link", () => import("@/test/next-link-mock"));

import { DashboardSuggestedFollowupsSection } from "./dashboard-suggested-followups-section";

function review(id: string, personName: string): SuggestedFollowupReviewView {
  return {
    component: {
      type: "suggested_followup_review",
      followupId: id,
      sourceRecordId: `source-${id}`,
    },
    personId: `person-${id}`,
    personName,
    followup: {
      id,
      reason: `Check in with ${personName}.`,
      status: "suggested",
      dueAtISO: "2026-08-01T00:00:00.000Z",
      dueAtDate: "2026-08-01",
      dueLabel: "Aug 1",
      dueState: "upcoming",
    },
    source: null,
  };
}

const first = review("followup-1", "Mark");
const second = review("followup-2", "Maya");

function Harness({ initial = [first, second] }: { initial?: SuggestedFollowupReviewView[] }) {
  const [reviews, setReviews] = useState(initial);
  return (
    <>
      <button id="followups-tab" type="button">
        Follow-ups tab
      </button>
      <DashboardSuggestedFollowupsSection
        fallbackFocusTarget={() => document.querySelector<HTMLElement>("#followups-tab")}
        onResolve={(id) =>
          setReviews((current) => current.filter((item) => item.followup.id !== id))
        }
        reviews={reviews}
      />
    </>
  );
}

describe("DashboardSuggestedFollowupsSection mutation feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.dismiss.mockImplementation(async ({ followupId }: { followupId: string }) => ({
      ok: true,
      view: followupId === first.followup.id ? first : second,
    }));
    actions.restore.mockResolvedValue({ ok: true, view: first });
  });
  afterEach(() => vi.useRealTimers());

  it("shows visible pending text and aria-busy while accepting", async () => {
    const user = userEvent.setup();
    let settle: (result: { ok: true; view: SuggestedFollowupReviewView }) => void = () => {};
    actions.accept.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    render(<Harness initial={[first]} />);

    await user.click(screen.getByRole("button", { name: "Accept suggested follow-up for Mark" }));

    const row = document.querySelector<HTMLElement>("[data-dashboard-suggested-followup-row]");
    expect(row?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getAllByText("Adding follow-up…").length).toBeGreaterThan(0);
    settle({ ok: true, view: first });
  });

  it("moves focus to the next row and then the heading when suggestions leave", async () => {
    vi.useFakeTimers();
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss suggested follow-up for Mark" }));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await act(async () => vi.advanceTimersByTimeAsync(32));
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Maya" }));

    fireEvent.click(screen.getByRole("button", { name: "Dismiss suggested follow-up for Maya" }));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await act(async () => vi.advanceTimersByTimeAsync(32));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Follow-ups tab" }));
  });
});
