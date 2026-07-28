import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentAccess,
  redirect,
  resolveAccountView,
  resolveReminderDeepLinkTarget,
  signInPathFor,
} = vi.hoisted(() => ({
  getCurrentAccess: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  resolveAccountView: vi.fn(),
  resolveReminderDeepLinkTarget: vi.fn(),
  signInPathFor: vi.fn((returnTo: string) => `/sign-in?returnTo=${encodeURIComponent(returnTo)}`),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@tendnote/db/queries/reminders", () => ({ resolveReminderDeepLinkTarget }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess }));
vi.mock("@/lib/access/account-summary", () => ({ resolveAccountView }));
vi.mock("@/lib/access/access-state", () => ({ localFallbackOwnerUserId: () => undefined }));
vi.mock("@/lib/auth/return-to", () => ({ signInPathFor }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));

import { ReminderOpenContent } from "./page";

const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const params = Promise.resolve({ kind: "general_action", id: ACTION_ID });

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentAccess.mockResolvedValue({ state: "admitted", user: { id: "owner-1" } });
  resolveAccountView.mockReturnValue({ type: "render" });
  resolveReminderDeepLinkTarget.mockResolvedValue({
    recordKind: "general_action",
    recordId: ACTION_ID,
    personId: null,
  });
});

describe("Reminder deep-link recovery", () => {
  it("opens an eligible destination for the authenticated owner", async () => {
    await expect(ReminderOpenContent({ searchParams: params })).rejects.toThrow(
      `REDIRECT:/actions#action-${ACTION_ID}`,
    );
    expect(resolveReminderDeepLinkTarget).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      recordKind: "general_action",
      recordId: ACTION_ID,
    });
  });

  it("preserves the complete reminder target through sign-in", async () => {
    getCurrentAccess.mockResolvedValue({ state: "unauthenticated" });
    resolveAccountView.mockReturnValue({ type: "redirect", to: "/sign-in" });

    await expect(ReminderOpenContent({ searchParams: params })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    expect(signInPathFor).toHaveBeenCalledWith(
      `/reminders/open?kind=general_action&id=${ACTION_ID}`,
    );
    expect(resolveReminderDeepLinkTarget).not.toHaveBeenCalled();
  });

  it.each([
    "removed or visibility-lost",
    "already completed or resolved",
  ])("shows the same non-leaking state when the target is %s", async () => {
    resolveReminderDeepLinkTarget.mockResolvedValue(null);
    const markup = renderToStaticMarkup(await ReminderOpenContent({ searchParams: params }));

    expect(markup).toContain("Reminder unavailable");
    expect(markup).toContain("completed, removed, or is no longer available");
    expect(markup).not.toContain(ACTION_ID);
  });
});
