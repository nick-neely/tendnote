import { type AuthFn, ForbiddenError } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import {
  createLocalOwnerAuth,
  createSessionOwnershipGuard,
  createTendnoteSessionAuth,
  EveSessionNotFoundError,
  eveSessionIdFromRequest,
} from "../agent/lib/eve-auth";

const request = new Request("https://app.tendnote.test/eve/v1/session", {
  headers: { cookie: "better-auth.session_token=signed", "x-tendnote-owner-id": "forged" },
});

describe("hosted Eve session authentication", () => {
  it("passes the verified session identity through the shared admission decision", async () => {
    const resolveAccess = vi.fn().mockResolvedValue({ admitted: true });
    const auth = createTendnoteSessionAuth({
      getSession: vi.fn().mockResolvedValue({
        user: { id: "user-123", email: "owner@example.com", emailVerified: true },
      }),
      resolveAccess,
      checkIngressBudget: vi.fn().mockResolvedValue({ allowed: true }),
    });

    await expect(auth(request)).resolves.toMatchObject({ principalId: "user-123" });
    // The verified-ownership flag is threaded into admission so the self-hosted
    // owner grant sees the same trusted signal at the Eve boundary as on Web.
    expect(resolveAccess).toHaveBeenCalledWith({
      userId: "user-123",
      email: "owner@example.com",
      emailVerified: true,
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

const OWNER = {
  attributes: { channel: "eve" },
  authenticator: "better-auth",
  principalId: "user-owner",
  principalType: "user",
} as const;

const baseAuth: AuthFn<Request> = () => OWNER;

function sessionRequest(path: string): Request {
  return new Request(`https://app.tendnote.test${path}`, {
    headers: { cookie: "better-auth.session_token=signed" },
  });
}

/** Await the guard (whose declared return type is a union, not always a Promise) and return the thrown value. */
async function captureRejection(guard: AuthFn<Request>, path: string): Promise<unknown> {
  try {
    await guard(sessionRequest(path));
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("eveSessionIdFromRequest", () => {
  it("extracts the session id from every ID-addressed route", () => {
    for (const suffix of ["", "/stream", "/cancel", "/compact", "/clear", "/reset"]) {
      expect(eveSessionIdFromRequest(sessionRequest(`/eve/v1/session/sess-1${suffix}`))).toBe(
        "sess-1",
      );
    }
  });

  it("decodes a percent-encoded session id", () => {
    expect(eveSessionIdFromRequest(sessionRequest("/eve/v1/session/run%2F42/stream"))).toBe(
      "run/42",
    );
  });

  it("returns undefined for the create and info routes that carry no session id", () => {
    expect(eveSessionIdFromRequest(sessionRequest("/eve/v1/session"))).toBeUndefined();
    expect(eveSessionIdFromRequest(sessionRequest("/eve/v1/info"))).toBeUndefined();
  });
});

describe("Eve session ownership guard", () => {
  it("lets the owning principal attach, stream, continue, and reset their own session", async () => {
    const getOwnerUserId = vi.fn().mockResolvedValue("user-owner");
    const guard = createSessionOwnershipGuard({ auth: baseAuth, getOwnerUserId });

    for (const suffix of ["", "/stream", "/cancel", "/compact", "/clear", "/reset"]) {
      await expect(guard(sessionRequest(`/eve/v1/session/sess-1${suffix}`))).resolves.toMatchObject(
        {
          principalId: "user-owner",
        },
      );
    }
    expect(getOwnerUserId).toHaveBeenCalledWith("sess-1");
  });

  it("rejects a different admitted principal on any session-addressed op without leaking existence", async () => {
    const getOwnerUserId = vi.fn().mockResolvedValue("user-owner");
    const attacker: AuthFn<Request> = () => ({ ...OWNER, principalId: "user-attacker" });
    const guard = createSessionOwnershipGuard({ auth: attacker, getOwnerUserId });

    for (const suffix of ["", "/stream", "/cancel", "/compact", "/clear", "/reset"]) {
      const rejection = await captureRejection(guard, `/eve/v1/session/victim${suffix}`);
      expect(rejection).toBeInstanceOf(EveSessionNotFoundError);
      expect((rejection as EveSessionNotFoundError).response.status).toBe(404);
    }
  });

  it("fails closed with an opaque 404 when no owner binding exists yet", async () => {
    const getOwnerUserId = vi.fn().mockResolvedValue(null);
    const guard = createSessionOwnershipGuard({ auth: baseAuth, getOwnerUserId });

    const rejection = await captureRejection(guard, "/eve/v1/session/unbound/stream");
    expect(rejection).toBeInstanceOf(EveSessionNotFoundError);
    expect((rejection as EveSessionNotFoundError).response.status).toBe(404);
  });

  it("returns an identical not-found body for a foreign and an unknown session", async () => {
    const foreignGuard = createSessionOwnershipGuard({
      auth: baseAuth,
      getOwnerUserId: vi.fn().mockResolvedValue("someone-else"),
    });
    const unknownGuard = createSessionOwnershipGuard({
      auth: baseAuth,
      getOwnerUserId: vi.fn().mockResolvedValue(null),
    });

    const read = async (guard: AuthFn<Request>) => {
      const error = (await captureRejection(
        guard,
        "/eve/v1/session/x/stream",
      )) as EveSessionNotFoundError;
      return { status: error.response.status, body: await error.response.clone().text() };
    };

    expect(await read(foreignGuard)).toEqual(await read(unknownGuard));
  });

  it("skips the ownership lookup for the create and info routes", async () => {
    const getOwnerUserId = vi.fn();
    const guard = createSessionOwnershipGuard({ auth: baseAuth, getOwnerUserId });

    await expect(guard(sessionRequest("/eve/v1/session"))).resolves.toMatchObject({
      principalId: "user-owner",
    });
    await expect(guard(sessionRequest("/eve/v1/info"))).resolves.toMatchObject({
      principalId: "user-owner",
    });
    expect(getOwnerUserId).not.toHaveBeenCalled();
  });

  it("never authorizes a session for an unauthenticated caller", async () => {
    const getOwnerUserId = vi.fn();
    const guard = createSessionOwnershipGuard({ auth: () => null, getOwnerUserId });

    await expect(guard(sessionRequest("/eve/v1/session/sess-1/stream"))).resolves.toBeNull();
    expect(getOwnerUserId).not.toHaveBeenCalled();
  });

  it("walks an ordered auth array and lets a rejected authenticator propagate", async () => {
    const skip: AuthFn<Request> = () => null;
    const getOwnerUserId = vi.fn().mockResolvedValue("user-owner");
    const guard = createSessionOwnershipGuard({ auth: [skip, baseAuth], getOwnerUserId });
    await expect(guard(sessionRequest("/eve/v1/session/sess-1"))).resolves.toMatchObject({
      principalId: "user-owner",
    });

    const forbid: AuthFn<Request> = () => {
      throw new ForbiddenError({ code: "denied", message: "no" });
    };
    const forbidGuard = createSessionOwnershipGuard({ auth: [forbid], getOwnerUserId: vi.fn() });
    await expect(forbidGuard(sessionRequest("/eve/v1/session/sess-1"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
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
