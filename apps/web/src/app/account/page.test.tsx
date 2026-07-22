import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  redirect,
  getCurrentAccess,
  resolveAccountView,
  getOwnerProviderConnections,
  getOwnerCalendarPreview,
} = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  resolveAccountView: vi.fn(),
  getOwnerProviderConnections: vi.fn(),
  getOwnerCalendarPreview: vi.fn().mockResolvedValue({ state: "hidden" }),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess }));
vi.mock("@/lib/access/account-summary", () => ({ resolveAccountView }));
vi.mock("@/lib/access/access-state", () => ({ localFallbackOwnerUserId: () => undefined }));
vi.mock("@/lib/integrations/provider-connections", () => ({ getOwnerProviderConnections }));
vi.mock("@/lib/integrations/provider-connection-view", () => ({
  buildProviderConnectionView: () => [],
}));
vi.mock("@/lib/integrations/calendar-preview-data", () => ({
  getOwnerCalendarPreview,
}));
// Presentational shells are exercised by their own tests; stub them here.
vi.mock("@/components/account/calendar-preview-section", () => ({
  CalendarPreviewSection: () => null,
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/auth/sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("@/components/account/provider-connections-section", () => ({
  ProviderConnectionsSection: () => null,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: unknown }) => children,
}));

import AccountPage from "./page";

beforeEach(() => {
  getCurrentAccess.mockReset();
  resolveAccountView.mockReset();
  getOwnerProviderConnections.mockReset();
  getOwnerCalendarPreview.mockReset().mockResolvedValue({ state: "hidden" });
  redirect.mockClear();
});

describe("AccountPage access gating", () => {
  it("redirects pending/unauthenticated users before reading any connection state", async () => {
    getCurrentAccess.mockResolvedValue({ state: "pending" });
    resolveAccountView.mockReturnValue({ type: "redirect", to: "/pending" });

    await expect(AccountPage()).rejects.toThrow("REDIRECT:/pending");
    expect(redirect).toHaveBeenCalledWith("/pending");
    // The connections read never runs for a non-admitted caller.
    expect(getOwnerProviderConnections).not.toHaveBeenCalled();
  });

  it("reads connection state only after an admitted view resolves", async () => {
    getCurrentAccess.mockResolvedValue({ state: "admitted", user: { id: "owner-1" } });
    resolveAccountView.mockReturnValue({
      type: "render",
      name: "Nick",
      email: "nick@example.com",
      sourceLabel: "Initial owner",
    });
    getOwnerProviderConnections.mockResolvedValue([]);

    await AccountPage();

    expect(getOwnerProviderConnections).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("passes a canonical Calendar result target into the bounded preview read", async () => {
    getCurrentAccess.mockResolvedValue({ state: "admitted", user: { id: "owner-1" } });
    resolveAccountView.mockReturnValue({
      type: "render",
      name: "Nick",
      email: "nick@example.com",
      sourceLabel: "Initial owner",
    });
    getOwnerProviderConnections.mockResolvedValue([]);

    await AccountPage({
      searchParams: Promise.resolve({
        calendarId: "primary",
        calendarEvent: "event-filter",
        calendarStart: "2026-07-23T15:00:00.000Z",
        calendarQuery: "Filter installation meeting",
      }),
    });

    expect(getOwnerCalendarPreview).toHaveBeenCalledWith({
      calendarId: "primary",
      providerEventId: "event-filter",
      start: new Date("2026-07-23T15:00:00.000Z"),
      query: "Filter installation meeting",
    });
  });
});
