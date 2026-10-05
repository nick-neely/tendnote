// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { replace, skipFirstRunAction, closeIntegrationOfferAction } = vi.hoisted(() => ({
  replace: vi.fn(),
  skipFirstRunAction: vi.fn(),
  closeIntegrationOfferAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/first-run", () => ({ closeIntegrationOfferAction, skipFirstRunAction }));
vi.mock("@/components/dashboard-brief-section", () => ({ DashboardBriefSection: () => null }));
vi.mock("@/components/dashboard-calendar-suggestions-section", () => ({
  DashboardCalendarSuggestionsSection: () => null,
}));
vi.mock("@/components/dashboard-followups-section", () => ({
  DashboardFollowupsSection: () => null,
}));
vi.mock("@/components/dashboard-suggested-followups-section", () => ({
  DashboardSuggestedFollowupsSection: () => null,
}));

import { DashboardRail } from "./dashboard-rail";
import { FirstRunSkipButton, FirstRunWelcome } from "./first-run-welcome";
import { IntegrationOffer } from "./integration-offer";

beforeEach(() => {
  vi.clearAllMocks();
  skipFirstRunAction.mockResolvedValue({ ok: true, view: null });
  closeIntegrationOfferAction.mockResolvedValue({ ok: true, view: null });
});

function rail(firstRunRepeat: boolean) {
  return (
    <DashboardRail
      birthdays={[]}
      calendarSuggestions={[]}
      dailyBrief={null}
      firstRunRepeat={firstRunRepeat}
      followupReviews={[]}
      followups={[]}
      initialTab="today"
      people={[]}
      reviewContent={null}
      reviewCount={0}
      weeklyBrief={null}
    />
  );
}

describe("first run", () => {
  it("asks the one question on admission", () => {
    render(<FirstRunWelcome variant="dashboard" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "You’re in. Who did you talk to this week?" }),
    ).toBeTruthy();
  });

  it("skips onto the Home that repeats the prompt once", async () => {
    const user = userEvent.setup();
    render(<FirstRunSkipButton />);

    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(skipFirstRunAction).toHaveBeenCalledOnce();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/?firstRun=skipped"));
  });

  it("stays put and says so when the skip fails", async () => {
    const user = userEvent.setup();
    skipFirstRunAction.mockRejectedValue(new Error("offline"));
    render(<FirstRunSkipButton />);

    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("repeats the question in the empty Today rail only when asked to", () => {
    const { rerender } = render(rail(true));
    expect(screen.getByText("Who did you talk to this week?")).toBeTruthy();

    rerender(rail(false));
    expect(screen.queryByText("Who did you talk to this week?")).toBeNull();
  });
});

describe("integrations offer", () => {
  it("closes for good when set aside", async () => {
    const user = userEvent.setup();
    render(<IntegrationOffer />);

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(closeIntegrationOfferAction).toHaveBeenCalledOnce();
  });

  it("leads to the Account page's integrations", () => {
    render(<IntegrationOffer />);
    expect(screen.getByRole("link", { name: "See integrations" }).getAttribute("href")).toBe(
      "/account#integrations",
    );
  });
});
