import {
  CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE,
  createFakeContextFactImportExtractionAdapter,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  createContextFactImportQueries,
  createInMemoryContextFactImportStore,
} from "./context-fact-imports";
import { createContextFactQueries } from "./context-facts";

const OWNER = "user-owner";
const verifiedCallerFor = (userId: string) => async () => userId;

function block(...lines: string[]) {
  return ["```" + CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE, ...lines, "```"].join("\n");
}

function setup(
  options: Parameters<typeof createContextFactImportQueries>[1] = {},
  ownerUserId = OWNER,
) {
  const store = createInMemoryContextFactImportStore();
  const queries = createContextFactImportQueries(store, {
    resolveVerifiedCaller: verifiedCallerFor(ownerUserId),
    ...options,
  });
  const contextFactQueries = createContextFactQueries(store, {
    resolveVerifiedCaller: verifiedCallerFor(ownerUserId),
  });
  return { store, queries, contextFactQueries };
}

const PASTE = block(
  "work | normal | I run a software consultancy.",
  "location | normal | I am based in Chicago.",
  "interest | normal | I follow trail running.",
);

describe("importSelfContextFacts", () => {
  it("reads the fenced block locally and never calls the extraction adapter", async () => {
    let adapterCalls = 0;
    const { queries, store } = setup({
      extractionAdapter: {
        kind: "fake",
        async extractCandidates() {
          adapterCalls += 1;
          return { candidates: [] };
        },
      },
    });

    const result = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: PASTE,
    });

    expect(adapterCalls).toBe(0);
    expect(result.summary.source).toBe("block");
    expect(result.summary.suggestedCount).toBe(3);
    expect(result.reviews).toHaveLength(3);
    expect([...store.records.values()].every((fact) => fact.lifecycle === "suggested")).toBe(true);
  });

  it("lands every imported fact as review-gated context with import provenance", async () => {
    const { queries, store } = setup();

    const result = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "gemini",
      text: PASTE,
    });

    for (const fact of store.records.values()) {
      expect(fact.lifecycle).toBe("suggested");
      expect(fact.provenance).toEqual({
        channel: "import",
        origin: "import",
        sourceRecordId: result.summary.importId,
      });
      expect(fact.suggestionEvidence).toContain("From your Gemini memory:");
    }
  });

  it("records the import session the provenance points at, without keeping the paste", async () => {
    const { queries, store } = setup();

    const result = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "claude",
      text: PASTE,
    });

    const record = await store.getContextFactImport(result.summary.importId);
    expect(record).toMatchObject({
      ownerUserId: OWNER,
      provider: "claude",
      source: "block",
      textLength: PASTE.length,
      candidateCount: 3,
    });
    expect(JSON.stringify(record)).not.toContain("software consultancy");
  });

  it("falls back to one bounded extraction pass over loose prose", async () => {
    const { queries } = setup({
      extractionAdapter: createFakeContextFactImportExtractionAdapter([
        {
          category: "work",
          content: "I run a software consultancy.",
          evidence: "you run a small software consultancy",
          sensitivity: "normal",
        },
      ]),
    });

    const result = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: "From what I remember, you run a small software consultancy.",
    });

    expect(result.summary.source).toBe("extraction");
    expect(result.summary.suggestedCount).toBe(1);
  });

  it("proposes nothing from loose prose when no extraction adapter is configured", async () => {
    const { queries } = setup();

    const result = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: "From what I remember, you run a small software consultancy.",
    });

    expect(result.summary).toMatchObject({ source: "extraction", suggestedCount: 0 });
    expect(result.reviews).toHaveLength(0);
  });

  it("counts lines it could not read instead of dropping them silently", async () => {
    const { queries } = setup();

    const result = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: block(
        "work | normal | I run a software consultancy.",
        "I am based in Chicago.",
        "location | normal | I live at 1400 Maple Street, Chicago 60601.",
      ),
    });

    expect(result.summary.suggestedCount).toBe(1);
    expect(result.summary.unreadableCount).toBe(2);
  });

  it("reuses a pending suggestion rather than proposing it twice", async () => {
    const { queries } = setup();

    await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: PASTE,
    });
    const second = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: PASTE,
    });

    expect(second.summary).toMatchObject({ suggestedCount: 0, alreadyPendingCount: 3 });
    expect(second.reviews).toHaveLength(3);
  });

  it("holds back a statement the owner dismissed before, and says how many", async () => {
    const { queries, contextFactQueries } = setup();

    const first = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: PASTE,
    });
    for (const review of first.reviews) {
      await contextFactQueries.dismissSuggestedContextFact({
        callerUserId: OWNER,
        contextFactId: review.fact.id,
      });
    }

    const second = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: PASTE,
    });

    expect(second.summary).toMatchObject({ suggestedCount: 0, skippedCount: 3 });
  });

  it("keeps an accepted import as active context with its import provenance intact", async () => {
    const { queries, contextFactQueries, store } = setup();

    const result = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: block("work | normal | I run a software consultancy."),
    });
    const suggested = result.reviews[0];
    if (!suggested) throw new Error("The import proposed nothing to accept.");
    const accepted = await contextFactQueries.acceptSuggestedContextFact({
      callerUserId: OWNER,
      contextFactId: suggested.fact.id,
    });

    expect(accepted.result.lifecycle).toBe("active");
    // The owner-facing view omits raw source ids by design; the stored record keeps
    // the reference back to the import session that proposed the fact.
    expect(store.records.get(accepted.result.id)?.provenance).toEqual({
      channel: "import",
      origin: "import",
      sourceRecordId: result.summary.importId,
    });
    expect([...store.records.values()]).toHaveLength(1);
  });

  it("refuses a caller that does not match the authenticated session", async () => {
    const { queries } = setup({}, "user-other");

    await expect(
      queries.importSelfContextFacts({ callerUserId: OWNER, provider: "chatgpt", text: PASTE }),
    ).rejects.toThrow("A verified caller is required.");
  });

  it("refuses a paste larger than one bounded import", async () => {
    const { queries } = setup();

    await expect(
      queries.importSelfContextFacts({
        callerUserId: OWNER,
        provider: "chatgpt",
        text: "x".repeat(20_000),
      }),
    ).rejects.toThrow(/too long/);
  });

  it("writes one audit entry naming the session's shape and how it was read", async () => {
    const { queries, store } = setup();

    const result = await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: PASTE,
    });

    const entries = await store.listAuditLogEntries({ ownerUserId: OWNER });
    const completed = entries.find((entry) => entry.action === "context_fact_import.completed");
    expect(completed).toMatchObject({
      entityType: "context_fact_import",
      entityId: result.summary.importId,
      metadataJson: { provider: "chatgpt", source: "block", suggestedCount: 3 },
    });
  });

  it("lists an owner's imports without leaking another owner's", async () => {
    const { queries, store } = setup();
    await queries.importSelfContextFacts({
      callerUserId: OWNER,
      provider: "chatgpt",
      text: PASTE,
    });
    await store.createContextFactImport({
      ownerUserId: "user-other",
      provider: "gemini",
      source: "block",
      textLength: 10,
      candidateCount: 0,
    });

    const imports = await queries.listContextFactImports(OWNER);

    expect(imports).toHaveLength(1);
    expect(imports[0]?.ownerUserId).toBe(OWNER);
  });
});
