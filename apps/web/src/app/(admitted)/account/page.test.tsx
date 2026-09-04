import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  redirect,
  getCurrentAccess,
  resolveAccountView,
  getOwnerProviderConnections,
  getOwnerCalendarPreview,
  getLatestOwnerDataExportJob,
  listReminderInstallations,
  getEveApprovalMode,
  unstable_rethrow,
} = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
  resolveAccountView: vi.fn(),
  getOwnerProviderConnections: vi.fn(),
  getOwnerCalendarPreview: vi.fn().mockResolvedValue({ state: "hidden" }),
  getLatestOwnerDataExportJob: vi.fn().mockResolvedValue(null),
  listReminderInstallations: vi.fn().mockResolvedValue([]),
  getEveApprovalMode: vi.fn().mockResolvedValue("ask"),
  unstable_rethrow: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect, unstable_rethrow }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/actions/owner-data-export", () => ({
  requestOwnerDataExportAction: vi.fn(),
}));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess }));
vi.mock("@tendnote/db/queries/reminders", () => ({ listReminderInstallations }));
vi.mock("@tendnote/db/queries/access-profiles", () => ({ getEveApprovalMode }));
vi.mock("@tendnote/db/queries/owner-data-export", () => ({ getLatestOwnerDataExportJob }));
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
vi.mock("@/components/account/reminder-settings", () => ({ ReminderSettings: () => null }));
vi.mock("@/components/account/assistant-approval-settings", () => ({
  AssistantApprovalSettings: () => null,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: unknown }) => children,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { AccountContent, CalendarPreviewStream, ProviderConnectionsStream } from "./page";

beforeEach(() => {
  getCurrentAccess.mockReset();
  resolveAccountView.mockReset();
  getOwnerProviderConnections.mockReset();
  getOwnerCalendarPreview.mockReset().mockResolvedValue({ state: "hidden" });
  getLatestOwnerDataExportJob.mockReset().mockResolvedValue(null);
  listReminderInstallations.mockReset().mockResolvedValue([]);
  getEveApprovalMode.mockReset().mockResolvedValue("ask");
  redirect.mockClear();
  unstable_rethrow.mockReset();
});

describe("AccountPage access gating", () => {
  it("redirects pending/unauthenticated users before reading any connection state", async () => {
    getCurrentAccess.mockResolvedValue({ state: "pending" });
    resolveAccountView.mockReturnValue({ type: "redirect", to: "/pending" });

    await expect(AccountContent()).rejects.toThrow("REDIRECT:/pending");
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

    await ProviderConnectionsStream({
      calendarConnectable: true,
      contactsConnectable: true,
      discordConnectable: false,
      ensureLocalDemoAuthSession: false,
      gmailConnectable: true,
    });

    expect(getOwnerProviderConnections).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  /** Account owns the durable Household entry point; there is no global one. */
  it("offers the admitted owner a way into Household", async () => {
    getCurrentAccess.mockResolvedValue({ state: "admitted", user: { id: "owner-1" } });
    resolveAccountView.mockReturnValue({
      type: "render",
      name: "Nick",
      email: "nick@example.com",
      sourceLabel: "Initial owner",
    });

    const markup = renderToStaticMarkup(await AccountContent());

    expect(markup).toContain('href="/account/household"');
    expect(markup).toContain("Household");
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

    await CalendarPreviewStream({
      target: {
        calendarId: "primary",
        providerEventId: "event-filter",
        start: new Date("2026-07-23T15:00:00.000Z"),
        query: "Filter installation meeting",
      },
    });

    expect(getOwnerCalendarPreview).toHaveBeenCalledWith({
      calendarId: "primary",
      providerEventId: "event-filter",
      start: new Date("2026-07-23T15:00:00.000Z"),
      query: "Filter installation meeting",
    });
  });

  it("preserves Next control-flow exceptions from deferred provider reads", async () => {
    const controlFlow = new Error("NEXT_REDIRECT");
    getOwnerProviderConnections.mockRejectedValue(controlFlow);

    await ProviderConnectionsStream({
      calendarConnectable: true,
      contactsConnectable: true,
      discordConnectable: false,
      ensureLocalDemoAuthSession: false,
      gmailConnectable: true,
    });

    expect(unstable_rethrow).toHaveBeenCalledWith(controlFlow);
  });
});
