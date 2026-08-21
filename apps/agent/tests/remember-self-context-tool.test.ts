import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool } from "./test-tool";

const { createSelfContextFact, requestBackgroundAffectedScopeReconciliation } = vi.hoisted(() => ({
  createSelfContextFact: vi.fn(),
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
}));

vi.mock("@tendnote/db/queries/context-facts", () => ({ createSelfContextFact }));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawTool } = await import("../agent/tools/remember_self_context");
const tool = asTestTool(rawTool);
const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;

function fact() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    subject: { kind: "self", userId: "owner-1" },
    category: "work",
    content: "I run a small software consultancy.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "eve", origin: "direct", sourceRecordId: null },
    reviewedAt: new Date("2026-08-19T00:00:00.000Z"),
    archivedAt: null,
    createdAt: new Date("2026-08-18T00:00:00.000Z"),
    updatedAt: new Date("2026-08-19T00:00:00.000Z"),
    trust: "untrusted_data",
    authority: "none",
    visibility: "private",
  };
}

beforeEach(() => vi.clearAllMocks());

describe("remember_self_context", () => {
  it("calls the direct write even when the equivalent fact already exists", async () => {
    createSelfContextFact.mockResolvedValue({
      decision: "existing",
      result: fact(),
      affectedScopes: [],
    });

    const output = await tool.execute(
      {
        category: "work",
        content: "I run a small software consultancy.",
      },
      ctx,
    );

    expect(createSelfContextFact).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        category: "work",
        content: "I run a small software consultancy.",
        sensitivity: undefined,
        provenance: { channel: "eve", origin: "direct", sourceRecordId: null },
      },
      expect.any(Function),
    );
    expect(output).toMatchObject({ decision: "existing", created: false, reusedExisting: true });
    expect(output.guidance).toMatch(/idempotent|equivalent active fact|no duplicate/i);
    expect(requestBackgroundAffectedScopeReconciliation).toHaveBeenCalledWith([]);
  });
});
