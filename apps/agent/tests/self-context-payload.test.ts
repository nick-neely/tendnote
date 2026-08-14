import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTestTool, parseToolInput, toolModelValue } from "./test-tool";

/**
 * What the Self Context read and restore tools are allowed to send and to say.
 *
 * `list_self_context` used to answer with the same records three times over — a flat
 * list, a category grouping, and a set of recall rows — with no limit and no model
 * projection, so an ordinary "what do you know about me?" spent three copies of the
 * owner's whole set on one turn. `restore_self_context` reported a restore on the
 * branch where the store restored nothing: it found an equivalent *active* fact,
 * left the archived one archived, and handed back the other record.
 *
 * These pin the payload shape and the branch reporting, not any one sentence.
 */
const {
  listSelfContextFacts,
  requestBackgroundAffectedScopeReconciliation,
  restoreSelfContextFact,
} = vi.hoisted(() => ({
  listSelfContextFacts: vi.fn(),
  requestBackgroundAffectedScopeReconciliation: vi.fn(),
  restoreSelfContextFact: vi.fn(),
}));

vi.mock("@tendnote/db/queries/context-facts", () => ({
  listSelfContextFacts,
  restoreSelfContextFact,
}));
vi.mock("@tendnote/db/queries/global-recall", () => ({
  toSelfContextResult: ({ fact }: { fact: { id: string } }) => ({
    href: `/account/about-you#context-fact-${fact.id}`,
  }),
}));
vi.mock("../agent/lib/request-affected-scope-reconciliation", () => ({
  requestBackgroundAffectedScopeReconciliation,
}));

const { default: rawListTool } = await import("../agent/tools/list_self_context");
const { default: rawRestoreTool } = await import("../agent/tools/restore_self_context");
const listTool = asTestTool(rawListTool);
const restoreTool = asTestTool(rawRestoreTool);

const ctx = { session: { auth: { current: { principalId: "owner-1" } } } } as never;
const FACT_ID = "22222222-2222-4222-8222-222222222222";

function fact(index: number) {
  return {
    id: `fact-${index}`,
    subject: { kind: "self", userId: "owner-1" },
    category: "work",
    content: `Fact ${index}`,
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "web", origin: "explicit" },
    reviewedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    trust: "self_context",
    authority: "owner",
    visibility: { choice: "only_me", label: "Only me" },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("list_self_context sends one bounded copy of each fact", () => {
  it("returns a single facts array — no category grouping, no duplicate recall rows", async () => {
    listSelfContextFacts.mockResolvedValue([fact(1), fact(2)]);

    const output = await listTool.execute(parseToolInput(rawListTool, {}), ctx);

    expect(output.count).toBe(2);
    expect(output.hasMore).toBe(false);
    expect(output.facts).toHaveLength(2);
    expect(output).not.toHaveProperty("factsByCategory");
    expect(output).not.toHaveProperty("results");
    // Each fact still carries its canonical About you link, from the shared normalizer.
    expect(output.facts[0]?.href).toBe("/account/about-you#context-fact-fact-1");
    expect(output.facts[0]?.categoryLabel).toEqual(expect.any(String));
  });

  it("applies a schema default limit and says plainly when facts were left out", async () => {
    listSelfContextFacts.mockResolvedValue(
      Array.from({ length: 40 }, (_, index) => fact(index + 1)),
    );

    const output = await listTool.execute(parseToolInput(rawListTool, {}), ctx);

    expect(output.count).toBe(25);
    expect(output.hasMore).toBe(true);
    const model = toolModelValue(rawListTool, output);
    expect(model.hasMore).toBe(true);
    expect(model.guidance).toMatch(/More facts exist/);
  });

  it("honors an explicit limit and keeps the correction handles in the model projection", async () => {
    listSelfContextFacts.mockResolvedValue([fact(1), fact(2), fact(3)]);

    const output = await listTool.execute(parseToolInput(rawListTool, { limit: 2 }), ctx);

    expect(output.count).toBe(2);
    const model = toolModelValue(rawListTool, output);
    // The projection replaces what the model sees, so the id and the concurrency
    // token an explicit correction needs have to survive it.
    expect(model.facts).toEqual([
      expect.objectContaining({ id: "fact-1", updatedAt: "2026-07-02T00:00:00.000Z" }),
      expect.objectContaining({ id: "fact-2", updatedAt: "2026-07-02T00:00:00.000Z" }),
    ]);
    expect(model.guidance).toMatch(/expectedUpdatedAt/);
  });
});

describe("restore_self_context reports the restore that actually happened", () => {
  it("confirms a real restore", async () => {
    restoreSelfContextFact.mockResolvedValue({
      decision: "restored",
      result: fact(1),
      affectedScopes: [],
    });

    const output = await restoreTool.execute({ contextFactId: FACT_ID }, ctx);

    expect(output.restored).toBe(true);
    expect(output.guidance).toMatch(/active again/i);
  });

  it("does not claim a restore when an equivalent fact was already active", async () => {
    // The store's duplicate branch: the archived fact stays archived and the *other*
    // active fact comes back, so a "restored" report would be false twice over.
    restoreSelfContextFact.mockResolvedValue({
      decision: "existing",
      result: fact(9),
      affectedScopes: [],
    });

    const output = await restoreTool.execute({ contextFactId: FACT_ID }, ctx);

    expect(output.restored).toBe(false);
    expect(output.guidance).toMatch(/Nothing was restored/);
    expect(output.guidance).toMatch(/already active/);
  });
});
