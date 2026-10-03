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
vi.mock("@/components/auth/credentials-form", () => ({
  CredentialsForm: (props: { clickwrap?: unknown }) => props,
}));

import SignUpPage from "./page";

const user = { id: "user-1", email: "ada@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  getCurrentAccess.mockResolvedValue({ state: "unauthenticated" });
});

describe("the sign-up page", () => {
  it.each([
    ["an account that owes re-acceptance", "reacceptance", "/accept-terms"],
    ["an admitted account", "admitted", "/"],
    ["a pending account", "pending", "/pending"],
  ])("sends %s where it belongs", async (_, state, to) => {
    getCurrentAccess.mockResolvedValue({ state, user });

    await expect(SignUpPage()).rejects.toThrow(`REDIRECT:${to}`);
  });

  it("asks a hosted visitor to accept the current documents", async () => {
    const page = await SignUpPage();

    expect(JSON.stringify(page)).toContain("terms_of_service");
  });

  it("shows no clickwrap on a self-hosted deployment", async () => {
    vi.stubEnv("TENDNOTE_ADMISSION_MODE", "self-hosted");
    vi.stubEnv("TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL", "owner@example.com");

    const page = await SignUpPage();

    expect(JSON.stringify(page)).not.toContain("terms_of_service");
  });
});
