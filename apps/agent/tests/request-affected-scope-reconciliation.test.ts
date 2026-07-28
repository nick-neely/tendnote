import { createHmac } from "node:crypto";
import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestBackgroundAffectedScopeReconciliation } from "../agent/lib/request-affected-scope-reconciliation";

const scopes: AffectedScope[] = [
  {
    kind: "viewer-collection",
    collection: "general-actions",
    viewerUserId: "owner-1",
  },
];

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalSecret = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET = "test-reconciliation-secret";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  process.env.BETTER_AUTH_SECRET = originalSecret;
});

describe("Eve affected-scope reconciliation transport", () => {
  it("sends a signed bounded request to the web-owned Next handler", async () => {
    await requestBackgroundAffectedScopeReconciliation(scopes);

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url?.toString()).toBe("http://localhost:3000/api/internal/cache/reconcile");
    const body = String(init?.body);
    const timestamp = new Headers(init?.headers).get("x-tendnote-reconcile-timestamp");
    expect(timestamp).toBeTruthy();
    expect(new Headers(init?.headers).get("x-tendnote-reconcile-signature")).toBe(
      createHmac("sha256", "test-reconciliation-secret")
        .update(`${timestamp}.${body}`)
        .digest("hex"),
    );
    expect(JSON.parse(body)).toEqual({ scopes });
  });

  it("does not throw after a committed mutation when cache transport fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("web unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(requestBackgroundAffectedScopeReconciliation(scopes)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does no network work when a mutation reports no scopes", async () => {
    await requestBackgroundAffectedScopeReconciliation([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
