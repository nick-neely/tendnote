import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, getCurrentAccess } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  getCurrentAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/access/current-access", () => ({ getCurrentAccess }));
vi.mock("@/components/auth/auth-scaffold", () => ({
  AuthScaffold: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/billing/admission-poller", () => ({ AdmissionPoller: () => null }));

import ConfirmingPage from "./page";

const user = { id: "subscriber-1", email: "subscriber@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  getCurrentAccess.mockResolvedValue({ state: "pending", user });
});

describe("the confirming page", () => {
  it("waits on a pending hosted account, reading only Tendnote's admission record", async () => {
    await expect(ConfirmingPage()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("waits on a Lapsed account that resubscribed (#609)", async () => {
    getCurrentAccess.mockResolvedValueOnce({
      state: "lapsed",
      user,
      retentionDeadline: new Date("2027-01-29T17:04:05.000Z"),
    });

    await expect(ConfirmingPage()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("waits on a Household Guest that subscribed instead of returning it to the library (#637)", async () => {
    getCurrentAccess.mockResolvedValueOnce({ state: "guest", user, householdId: "household-1" });

    await expect(ConfirmingPage()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets the account in once Paid Access has landed", async () => {
    getCurrentAccess.mockResolvedValueOnce({ state: "admitted", user, ownerUserId: user.id });

    await expect(ConfirmingPage()).rejects.toThrow("REDIRECT:/");
  });

  it("sends a signed-out visitor to sign in", async () => {
    getCurrentAccess.mockResolvedValueOnce({ state: "unauthenticated" });

    await expect(ConfirmingPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("has nothing to confirm on a self-hosted deployment", async () => {
    vi.stubEnv("TENDNOTE_ADMISSION_MODE", "self-hosted");
    vi.stubEnv("TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL", "owner@example.com");

    await expect(ConfirmingPage()).rejects.toThrow("REDIRECT:/pending");
  });
});
