import { ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { createLocalOwnerAuth, createTendnoteSessionAuth } from "../agent/lib/eve-auth";

const request = new Request("https://app.tendnote.test/eve/v1/session", {
  headers: { cookie: "better-auth.session_token=signed", "x-tendnote-owner-id": "forged" },
});

describe("hosted Eve session authentication", () => {
  it("passes the verified session identity through the shared admission decision", async () => {
    const resolveAccess = vi.fn().mockResolvedValue({ admitted: true });
    const auth = createTendnoteSessionAuth({
      getSession: vi.fn().mockResolvedValue({
        user: { id: "user-123", email: "owner@example.com" },
      }),
      resolveAccess,
      checkIngressBudget: vi.fn().mockResolvedValue({ allowed: true }),
    });

    await expect(auth(request)).resolves.toMatchObject({ principalId: "user-123" });
    expect(resolveAccess).toHaveBeenCalledWith({
      userId: "user-123",
      email: "owner@example.com",
    });
  });

  it("scopes an admitted session to its verified Better Auth user", async () => {
    const auth = createTendnoteSessionAuth({
      getSession: vi.fn().mockResolvedValue({ user: { id: "user-123" } }),
      checkAccess: vi.fn().mockResolvedValue({ admitted: true }),
      checkIngressBudget: vi.fn().mockResolvedValue({ allowed: true }),
    });

    await expect(auth(request)).resolves.toMatchObject({
      authenticator: "better-auth",
      principalId: "user-123",
      principalType: "user",
    });
  });

  it("ignores a forged owner header when no session exists", async () => {
    const auth = createTendnoteSessionAuth({
      getSession: vi.fn().mockResolvedValue(null),
      checkAccess: vi.fn(),
      checkIngressBudget: vi.fn(),
    });

    await expect(auth(request)).resolves.toBeNull();
  });

  it("rejects a signed-in user without private beta access", async () => {
    const auth = createTendnoteSessionAuth({
      getSession: vi.fn().mockResolvedValue({ user: { id: "pending-user" } }),
      checkAccess: vi.fn().mockResolvedValue({ admitted: false }),
      checkIngressBudget: vi.fn(),
    });

    await expect(auth(request)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed when the ingress budget is unavailable or exhausted", async () => {
    const auth = createTendnoteSessionAuth({
      getSession: vi.fn().mockResolvedValue({ user: { id: "user-123" } }),
      checkAccess: vi.fn().mockResolvedValue({ admitted: true }),
      checkIngressBudget: vi.fn().mockResolvedValue({ allowed: false }),
    });

    await expect(auth(request)).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

describe("local Eve authentication", () => {
  it("maps Eve's loopback-only local principal to the explicit demo owner", async () => {
    const auth = createLocalOwnerAuth(
      vi.fn().mockResolvedValue({
        attributes: {},
        authenticator: "local-dev",
        principalId: "local-dev",
        principalType: "local-dev",
      }),
      { TENDNOTE_DEV_OWNER_USER_ID: "demo-owner" },
    );

    await expect(auth(new Request("http://localhost:3000/eve/v1/session"))).resolves.toMatchObject({
      authenticator: "tendnote-local-dev",
      principalId: "demo-owner",
      principalType: "user",
    });
  });

  it("does not admit non-loopback requests", async () => {
    const auth = createLocalOwnerAuth(vi.fn().mockResolvedValue(null), {});
    await expect(auth(request)).resolves.toBeNull();
  });
});
