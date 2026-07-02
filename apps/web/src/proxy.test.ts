import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const getSession = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  getAuth: () => ({
    api: {
      getSession,
    },
  }),
}));

vi.mock("@tendnote/db/queries/access-profiles", () => ({
  checkAccess: vi.fn(async () => ({ admitted: false })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  getSession.mockReset();
});

describe("Eve auth proxy", () => {
  it("lets Discord interactions reach the agent signature verifier without a Better Auth session", async () => {
    const response = await proxy(new NextRequest("https://example.com/eve/v1/discord"));

    expect(response.status).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("keeps same-origin Eve chat behind session auth", async () => {
    vi.stubEnv("NODE_ENV", "production");
    getSession.mockResolvedValueOnce(null);

    const response = await proxy(new NextRequest("https://example.com/eve/v1/chat"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Sign in to use the assistant.",
    });
    expect(getSession).toHaveBeenCalledOnce();
  });
});
