import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimSelfContextOnboardingReminder,
  getSelfContextOnboardingState,
  requireAdmittedOwner,
  unstable_rethrow,
} = vi.hoisted(() => ({
  claimSelfContextOnboardingReminder: vi.fn(),
  getSelfContextOnboardingState: vi.fn(),
  requireAdmittedOwner: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@tendnote/db/queries/access-profiles", () => ({
  claimSelfContextOnboardingReminder,
  getSelfContextOnboardingState,
}));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwner }));
vi.mock("next/navigation", () => ({ unstable_rethrow }));
vi.mock("@/components/account/self-context-later-invitation", () => ({
  SelfContextLaterInvitation: () => <aside data-testid="later-invitation" />,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { SelfContextHomeInvitation } from "./self-context-home-invitation";

const DISMISSED_STATE = { status: "dismissed" as const, reminderAt: null };
const CLAIMED_STATE = {
  status: "dismissed" as const,
  reminderAt: new Date("2026-08-03T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwner.mockResolvedValue("owner-1");
  getSelfContextOnboardingState.mockResolvedValue({
    status: "not_started",
    reminderAt: null,
  });
  claimSelfContextOnboardingReminder.mockResolvedValue({
    claimed: false,
    state: DISMISSED_STATE,
  });
});

describe("Self Context Home invitation", () => {
  it("leaves Today available for a newly admitted owner", async () => {
    const markup = renderToStaticMarkup(
      await SelfContextHomeInvitation({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toBe("");
    expect(requireAdmittedOwner).toHaveBeenCalledWith({ returnTo: "/" });
    expect(getSelfContextOnboardingState).toHaveBeenCalledWith({ userId: "owner-1" });
    expect(claimSelfContextOnboardingReminder).not.toHaveBeenCalled();
  });

  it("does not claim the quiet invitation on the immediate post-dismissal return", async () => {
    getSelfContextOnboardingState.mockResolvedValue(DISMISSED_STATE);

    const markup = renderToStaticMarkup(
      await SelfContextHomeInvitation({
        searchParams: Promise.resolve({ selfContext: "skipped" }),
      }),
    );

    expect(markup).toBe("");
    expect(claimSelfContextOnboardingReminder).not.toHaveBeenCalled();
  });

  it("claims once on a later ordinary visit and keeps the next visit quiet", async () => {
    getSelfContextOnboardingState.mockResolvedValue(DISMISSED_STATE);
    claimSelfContextOnboardingReminder
      .mockResolvedValueOnce({ claimed: true, state: CLAIMED_STATE })
      .mockResolvedValueOnce({ claimed: false, state: CLAIMED_STATE });

    const firstVisit = renderToStaticMarkup(
      await SelfContextHomeInvitation({ searchParams: Promise.resolve({}) }),
    );
    const secondVisit = renderToStaticMarkup(
      await SelfContextHomeInvitation({ searchParams: Promise.resolve({}) }),
    );

    expect(firstVisit).toContain('data-testid="later-invitation"');
    expect(secondVisit).toBe("");
    expect(claimSelfContextOnboardingReminder).toHaveBeenNthCalledWith(1, {
      userId: "owner-1",
    });
    expect(claimSelfContextOnboardingReminder).toHaveBeenNthCalledWith(2, {
      userId: "owner-1",
    });
  });
});
