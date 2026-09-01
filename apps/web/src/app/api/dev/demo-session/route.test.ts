import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSession,
  createUser,
  ensureLocalDevelopmentAccessProfile,
  findUserById,
  serializeSignedCookie,
  updateAuthUserEmail,
} = vi.hoisted(() => ({
  createSession: vi.fn(),
  createUser: vi.fn(),
  ensureLocalDevelopmentAccessProfile: vi.fn(),
  findUserById: vi.fn(),
  serializeSignedCookie: vi.fn(),
  updateAuthUserEmail: vi.fn(),
}));

vi.mock("@tendnote/db/queries/access-profiles", () => ({ ensureLocalDevelopmentAccessProfile }));
vi.mock("@tendnote/db/queries/auth-users", () => ({ updateAuthUserEmail }));
vi.mock("better-call", () => ({ serializeSignedCookie }));
vi.mock("@/lib/auth/server", () => ({
  getAuth: () => ({
    $context: Promise.resolve({
      authCookies: {
        sessionToken: {
          name: "better-auth.session_token",
          attributes: { httpOnly: true, path: "/", sameSite: "Lax", secure: false },
        },
      },
      internalAdapter: {
        createSession,
        createUser,
        findUserById,
      },
      secret: "test-secret",
      sessionConfig: { expiresIn: 60 * 60 * 24 * 7 },
    }),
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  createSession.mockReset();
  createUser.mockReset();
  ensureLocalDevelopmentAccessProfile.mockReset();
  findUserById.mockReset();
  serializeSignedCookie.mockReset();
  updateAuthUserEmail.mockReset();
  updateAuthUserEmail.mockResolvedValue(undefined);
  delete process.env.TENDNOTE_DEV_OWNER_EMAIL;
  delete process.env.TENDNOTE_DEV_OWNER_USER_ID;
});

describe("POST /api/dev/demo-session", () => {
  it("creates a Better Auth session cookie for the local fallback owner", async () => {
    findUserById.mockResolvedValue(null);
    createUser.mockResolvedValue({ id: "demo-user" });
    createSession.mockResolvedValue({ token: "session-token" });
    serializeSignedCookie.mockResolvedValue("better-auth.session_token=signed; Path=/; HttpOnly");

    const response = await POST();

    expect(response.status).toBe(204);
    expect(findUserById).toHaveBeenCalledWith("demo-user");
    expect(createUser).toHaveBeenCalledWith(
      {
        id: "demo-user",
        email: "demo-user@local.tendnote.dev",
        name: "Local development",
        emailVerified: true,
      },
      { method: "local-development" },
    );
    expect(ensureLocalDevelopmentAccessProfile).toHaveBeenCalledWith({ userId: "demo-user" });
    expect(createSession).toHaveBeenCalledWith("demo-user");
    expect(serializeSignedCookie).toHaveBeenCalledWith(
      "better-auth.session_token",
      "session-token",
      "test-secret",
      {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
        sameSite: "Lax",
        secure: false,
      },
    );
    expect(response.headers.get("set-cookie")).toBe(
      "better-auth.session_token=signed; Path=/; HttpOnly",
    );
  });

  it("uses a configured local fallback owner email when creating the user", async () => {
    process.env.TENDNOTE_DEV_OWNER_EMAIL = "person@example.com";
    findUserById.mockResolvedValue(null);
    createUser.mockResolvedValue({ id: "demo-user", email: "person@example.com" });
    createSession.mockResolvedValue({ token: "session-token" });
    serializeSignedCookie.mockResolvedValue("better-auth.session_token=signed");

    const response = await POST();

    expect(response.status).toBe(204);
    expect(createUser).toHaveBeenCalledWith(
      {
        id: "demo-user",
        email: "person@example.com",
        name: "Local development",
        emailVerified: true,
      },
      { method: "local-development" },
    );
  });

  it("reuses an existing local fallback auth user", async () => {
    findUserById.mockResolvedValue({ id: "demo-user", email: "demo-user@local.tendnote.dev" });
    createSession.mockResolvedValue({ token: "session-token" });
    serializeSignedCookie.mockResolvedValue("better-auth.session_token=signed");

    const response = await POST();

    expect(response.status).toBe(204);
    expect(createUser).not.toHaveBeenCalled();
    expect(ensureLocalDevelopmentAccessProfile).toHaveBeenCalledWith({ userId: "demo-user" });
    expect(createSession).toHaveBeenCalledWith("demo-user");
  });

  it("updates an existing local fallback auth user when the configured email changes", async () => {
    process.env.TENDNOTE_DEV_OWNER_EMAIL = "person@example.com";
    findUserById.mockResolvedValue({ id: "demo-user", email: "demo-user@local.tendnote.dev" });
    createSession.mockResolvedValue({ token: "session-token" });
    serializeSignedCookie.mockResolvedValue("better-auth.session_token=signed");

    const response = await POST();

    expect(response.status).toBe(204);
    expect(updateAuthUserEmail).toHaveBeenCalledWith({
      email: "person@example.com",
      userId: "demo-user",
    });
    expect(ensureLocalDevelopmentAccessProfile).toHaveBeenCalledWith({ userId: "demo-user" });
    expect(createSession).toHaveBeenCalledWith("demo-user");
  });

  it("honors a custom local fallback owner id", async () => {
    process.env.TENDNOTE_DEV_OWNER_USER_ID = "local-owner";
    findUserById.mockResolvedValue({ id: "local-owner", email: "local-owner@local.tendnote.dev" });
    createSession.mockResolvedValue({ token: "session-token" });
    serializeSignedCookie.mockResolvedValue("better-auth.session_token=signed");

    await POST();

    expect(findUserById).toHaveBeenCalledWith("local-owner");
    expect(createSession).toHaveBeenCalledWith("local-owner");
  });
});
