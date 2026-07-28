import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reconcileAffectedScopes } = vi.hoisted(() => ({
  reconcileAffectedScopes: vi.fn(),
}));
vi.mock("@/lib/cache/reconcile-affected-scopes", () => ({ reconcileAffectedScopes }));

import { POST } from "./route";

const originalSecret = process.env.BETTER_AUTH_SECRET;
const secret = "test-reconciliation-secret";
const payload = {
  scopes: [
    {
      kind: "viewer-collection",
      collection: "general-actions",
      viewerUserId: "owner-1",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BETTER_AUTH_SECRET = secret;
});

afterEach(() => {
  process.env.BETTER_AUTH_SECRET = originalSecret;
});

function requestFor(body = JSON.stringify(payload), timestamp = Date.now().toString()) {
  return new Request("http://localhost/api/internal/cache/reconcile", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tendnote-reconcile-timestamp": timestamp,
      "x-tendnote-reconcile-signature": createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex"),
    },
    body,
  });
}

describe("internal affected-scope reconciliation route", () => {
  it("reconciles a valid signed request as background work", async () => {
    const response = await POST(requestFor());

    expect(response.status).toBe(204);
    expect(reconcileAffectedScopes).toHaveBeenCalledWith(payload.scopes, {
      origin: "background",
    });
  });

  it("rejects a forged signature before invoking the cache adapter", async () => {
    const request = requestFor();
    request.headers.set("x-tendnote-reconcile-signature", "00".repeat(32));

    expect((await POST(request)).status).toBe(401);
    expect(reconcileAffectedScopes).not.toHaveBeenCalled();
  });

  it("rejects replay outside the bounded clock window", async () => {
    const staleTimestamp = (Date.now() - 10 * 60 * 1000).toString();

    expect((await POST(requestFor(JSON.stringify(payload), staleTimestamp))).status).toBe(401);
    expect(reconcileAffectedScopes).not.toHaveBeenCalled();
  });
});
