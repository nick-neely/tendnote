import type { UsageNotice } from "@tendnote/domain/usage-bounds";
import type { AuthFn } from "eve/channels/auth";
import { describe, expect, it, vi } from "vitest";
import { createUsagePauseGuard } from "../agent/lib/eve-usage-guard";

const principal = {
  attributes: { channel: "eve" },
  authenticator: "better-auth",
  principalId: "owner-1",
  principalType: "user",
} as const;
const auth: AuthFn<Request> = async () => principal;
const paused: UsageNotice = {
  state: "paused",
  recovery: { kind: "resets_on", date: "2026-11-15" },
};

function post(path: string, body: unknown) {
  return new Request(`https://agent.tendnote.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function refusal(result: unknown): Promise<Response> {
  const thrown = await Promise.resolve(result).then(
    () => {
      throw new Error("expected the guard to refuse");
    },
    (error: unknown) => error,
  );
  return (thrown as { response: Response }).response;
}

describe("the interactive Account Ceiling at Eve's door", () => {
  it("refuses a new conversation while Eve is paused, naming the reset", async () => {
    const guard = createUsagePauseGuard({ auth, readUsageNotice: async () => paused });

    const response = await refusal(guard(post("/eve/v1/session", { message: "hello" })));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "eve_usage_paused",
      notice: paused,
    });
  });

  it("refuses a follow-up message while Eve is paused", async () => {
    const readUsageNotice = vi.fn(async () => paused);
    const guard = createUsagePauseGuard({ auth, readUsageNotice });

    const response = await refusal(guard(post("/eve/v1/session/s-1", { message: "and then?" })));

    expect(response.status).toBe(403);
    expect(readUsageNotice).toHaveBeenCalledWith("owner-1");
  });

  it("refuses an answer too, which Eve runs as new input when it matches nothing pending", async () => {
    const guard = createUsagePauseGuard({ auth, readUsageNotice: async () => paused });

    const response = await refusal(
      guard(
        post("/eve/v1/session/s-1", {
          inputResponses: [{ requestId: "unmatched", optionId: "approve" }],
        }),
      ),
    );

    expect(response.status).toBe(403);
  });

  it("still streams and cancels a turn already running", async () => {
    const readUsageNotice = vi.fn(async () => paused);
    const guard = createUsagePauseGuard({ auth, readUsageNotice });

    for (const request of [
      post("/eve/v1/session/s-1/cancel", {}),
      new Request("https://agent.tendnote.test/eve/v1/session/s-1/stream"),
      new Request("https://agent.tendnote.test/eve/v1/info"),
    ]) {
      await expect(guard(request)).resolves.toBe(principal);
    }
    expect(readUsageNotice).not.toHaveBeenCalled();
  });

  it("lets a message through when Eve is not paused, with the principal unchanged", async () => {
    const guard = createUsagePauseGuard({
      auth,
      readUsageNotice: async () => ({ state: "normal" }),
    });

    await expect(guard(post("/eve/v1/session", { message: "hello" }))).resolves.toBe(principal);
  });

  it("leaves the request body for Eve to read", async () => {
    const guard = createUsagePauseGuard({
      auth,
      readUsageNotice: async () => ({ state: "normal" }),
    });
    const request = post("/eve/v1/session", { message: "hello" });

    await guard(request);

    await expect(request.json()).resolves.toEqual({ message: "hello" });
  });

  it("checks nothing for a caller the inner policy did not authenticate", async () => {
    const readUsageNotice = vi.fn(async () => paused);
    const guard = createUsagePauseGuard({ auth: async () => null, readUsageNotice });

    await expect(guard(post("/eve/v1/session", { message: "hello" }))).resolves.toBeNull();
    expect(readUsageNotice).not.toHaveBeenCalled();
  });
});
