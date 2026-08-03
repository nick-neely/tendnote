import { describe, expect, it } from "vitest";
import {
  buildOrientationContext,
  DEFAULT_ORIENTATION_CONTEXT_BUDGET_BYTES,
} from "./context-fact-orientation";
import { type ContextFact, contextFactSchema } from "./context-facts";

const OWNER = "user-owner";

function fact(overrides: Partial<ContextFact> = {}): ContextFact {
  const createdAt = new Date("2026-08-01T12:00:00.000Z");
  return contextFactSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    subject: { kind: "self", userId: OWNER },
    category: "background",
    content: "I prefer concise answers.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "account", origin: "direct", sourceRecordId: null },
    suggestionEvidence: null,
    creatorUserId: OWNER,
    lastActorUserId: OWNER,
    reviewedAt: createdAt,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });
}

describe("Orientation Context", () => {
  it("emits exact canonical facts as explicitly untrusted data", () => {
    const result = buildOrientationContext({ callerUserId: OWNER, facts: [fact()] });

    expect(result.context.identity).toEqual({ kind: "authenticated_user", userId: OWNER });
    expect(result.context.facts).toEqual([
      expect.objectContaining({
        canonical: { type: "context_fact", id: "00000000-0000-4000-8000-000000000001" },
        subject: { kind: "self", userId: OWNER },
        category: "background",
        content: "I prefer concise answers.",
        trust: "untrusted_data",
        authority: "none",
        provenance: { channel: "account", origin: "direct" },
        sensitivity: "normal",
      }),
    ]);
    expect(result.serialized).toMatch(/^\{"identity"/);
    expect(result.serializedBytes).toBeLessThanOrEqual(DEFAULT_ORIENTATION_CONTEXT_BUDGET_BYTES);
  });

  it("filters inactive, restricted, and cross-owner facts before selection", () => {
    const result = buildOrientationContext({
      callerUserId: OWNER,
      facts: [
        fact({ id: "active" }),
        fact({ id: "suggested", lifecycle: "suggested" }),
        fact({ id: "archived", lifecycle: "archived", archivedAt: new Date() }),
        fact({ id: "restricted", sensitivity: "restricted" }),
        fact({
          id: "other-owner",
          subject: { kind: "self", userId: "another-user" },
        }),
      ],
    });

    expect(result.context.facts.map((item) => item.canonical.id)).toEqual(["active"]);
    expect(result.context.eligibleFactCount).toBe(1);
    expect(result.context.omittedFactCount).toBe(0);
  });

  it("includes every eligible fact when the measured budget allows it", () => {
    const facts = [
      fact({ id: "fact-1", category: "background" }),
      fact({ id: "fact-2", category: "work", content: "I run a small consultancy." }),
      fact({ id: "fact-3", category: "interest", content: "I enjoy trail running." }),
    ];
    const result = buildOrientationContext({
      callerUserId: OWNER,
      facts,
      maxBytes: 100_000,
    });

    expect(result.context.facts.map((item) => item.canonical.id)).toEqual([
      "fact-1",
      "fact-2",
      "fact-3",
    ]);
    expect(result.context.omittedFactCount).toBe(0);
  });

  it("uses deterministic subject reserves, category coverage, and recency under pressure", () => {
    const facts = [
      fact({ id: "background-old", category: "background", updatedAt: new Date("2026-07-01") }),
      fact({ id: "work-new", category: "work", updatedAt: new Date("2026-08-02") }),
      fact({ id: "interest-mid", category: "interest", updatedAt: new Date("2026-08-01") }),
      fact({ id: "preference-new", category: "preference", updatedAt: new Date("2026-08-03") }),
    ];
    const first = buildOrientationContext({ callerUserId: OWNER, facts, maxBytes: 1_150 });
    const second = buildOrientationContext({
      callerUserId: OWNER,
      facts: [...facts].reverse(),
      maxBytes: 1_150,
    });

    expect(first.serialized).toBe(second.serialized);
    expect(first.serializedBytes).toBeLessThanOrEqual(1_150);
    expect(first.context.facts.length).toBeGreaterThan(0);
    expect(new Set(first.context.facts.map((item) => item.category)).size).toBeGreaterThan(1);
    expect(first.context.omittedFactCount).toBeGreaterThan(0);
  });

  it("does not silently accept a non-positive budget", () => {
    expect(() => buildOrientationContext({ callerUserId: OWNER, facts: [], maxBytes: 0 })).toThrow(
      "Orientation Context budget must be positive",
    );
  });
});
