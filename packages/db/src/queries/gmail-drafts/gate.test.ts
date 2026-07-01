import { describe, expect, it } from "vitest";
import { createGmailApprovalGate } from "./gate";

const BASE = {
  ownerUserId: "user-1",
  messageDraftId: "d1",
  kind: "create" as const,
  recipient: { email: "casey@example.com", source: "manual_entry" as const, contactMethodId: null },
  subject: "Hi",
};

function gate(overrides: {
  connected?: boolean;
  status?: "draft" | "approved" | "dismissed" | "sent_manually" | null;
}) {
  return createGmailApprovalGate({
    isConnected: async (ref) => {
      // The gate always asks about the google/gmail capability.
      expect(ref).toEqual({ ownerUserId: "user-1", providerKey: "google", capabilityKey: "gmail" });
      return overrides.connected ?? true;
    },
    // "status" in overrides distinguishes an explicit null (draft gone) from the
    // default; a bare `?? "approved"` would swallow the null case.
    getDraftStatus: async () => ("status" in overrides ? (overrides.status ?? null) : "approved"),
  });
}

describe("shared Gmail approval gate (ADR-0092)", () => {
  it("allows a connected capability with an approved draft", async () => {
    expect(await gate({ connected: true, status: "approved" })(BASE)).toEqual({ ok: true });
  });

  it("blocks when Gmail is not connected", async () => {
    const result = await gate({ connected: false })(BASE);
    expect(result).toEqual({ ok: false, reason: "Gmail isn't connected." });
  });

  it("blocks when the draft no longer exists", async () => {
    const result = await gate({ status: null })(BASE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no longer exists/i);
  });

  it("blocks when the draft is not approved", async () => {
    for (const status of ["draft", "dismissed", "sent_manually"] as const) {
      const result = await gate({ status })(BASE);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toMatch(/approve/i);
    }
  });
});
