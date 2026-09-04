import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSelfContextOnboardingState, listSelfContextFacts, requireAdmittedOwner, redirect } =
  vi.hoisted(() => ({
    getSelfContextOnboardingState: vi.fn(),
    listSelfContextFacts: vi.fn(),
    requireAdmittedOwner: vi.fn(),
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT:${to}`);
    }),
  }));

vi.mock("@tendnote/db/queries/access-profiles", () => ({ getSelfContextOnboardingState }));
vi.mock("@tendnote/db/queries/context-facts", () => ({ listSelfContextFacts }));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwner }));
vi.mock("next/navigation", () => ({
  redirect,
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));
vi.mock("@/components/account/self-context-onboarding", () => ({
  SelfContextOnboarding: ({ initialFacts }: { initialFacts: unknown[] }) => (
    <div data-testid="self-context-onboarding">{initialFacts.length} facts</div>
  ),
}));

import { renderToStaticMarkup } from "react-dom/server";
import { SelfContextOnboardingContent } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwner.mockResolvedValue("owner-1");
  getSelfContextOnboardingState.mockResolvedValue({ status: "not_started", reminderAt: null });
  listSelfContextFacts.mockResolvedValue([]);
});

describe("Self Context onboarding route", () => {
  it("reads setup state and facts only after the admitted owner gate", async () => {
    const facts = [{ id: "fact-1" }];
    listSelfContextFacts.mockResolvedValue(facts);

    const markup = renderToStaticMarkup(await SelfContextOnboardingContent());

    expect(markup).toContain("1 facts");
    expect(getSelfContextOnboardingState).toHaveBeenCalledWith({ userId: "owner-1" });
    expect(listSelfContextFacts).toHaveBeenCalledWith(
      { callerUserId: "owner-1" },
      requireAdmittedOwner,
    );
    expect(requireAdmittedOwner).toHaveBeenCalledWith({ returnTo: "/onboarding/self-context" });
  });

  it("does not reopen completed setup", async () => {
    getSelfContextOnboardingState.mockResolvedValue({ status: "completed", reminderAt: null });

    await expect(SelfContextOnboardingContent()).rejects.toThrow("REDIRECT:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
