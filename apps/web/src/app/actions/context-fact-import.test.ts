import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceProductBudgetSpy,
  revalidatePathSpy,
  updateTagSpy,
} from "@/test/action-adapter-mocks";

const { importSelfContextFacts } = vi.hoisted(() => ({ importSelfContextFacts: vi.fn() }));

vi.mock("@tendnote/db/queries/context-fact-imports", () => ({ importSelfContextFacts }));

import { importSelfContextFactsAction } from "./context-fact-import";

const NOW = new Date("2026-08-03T12:00:00.000Z");
const IMPORT_ID = "00000000-0000-4000-8000-0000000000ff";
const FACT = {
  id: "00000000-0000-4000-8000-000000000001",
  subject: { kind: "self" },
  category: "work",
  content: "I run a software consultancy.",
  normalizedContent: "run software consultancy",
  lifecycle: "suggested",
  sensitivity: "normal",
  provenance: { channel: "import", origin: "import", sourceRecordId: IMPORT_ID },
  suggestionEvidence: 'From your ChatGPT memory: "I run a software consultancy."',
  creatorUserId: "owner-1",
  lastActorUserId: "owner-1",
  reviewedAt: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
} as const;
const AFFECTED_SCOPES = [
  { kind: "owner-collection", collection: "context-facts", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  importSelfContextFacts.mockResolvedValue({
    summary: {
      importId: IMPORT_ID,
      provider: "chatgpt",
      source: "block",
      suggestedCount: 1,
      alreadyPendingCount: 0,
      skippedCount: 0,
      unreadableCount: 0,
    },
    reviews: [{ fact: FACT, evidence: FACT.suggestionEvidence, activeMatch: null }],
    affectedScopes: AFFECTED_SCOPES,
  });
});

describe("importSelfContextFactsAction", () => {
  it("derives the owner from the session and never from the request", async () => {
    const result = await importSelfContextFactsAction({
      provider: "chatgpt",
      text: "  ```tendnote-context\nwork | normal | I run a software consultancy.\n```  ",
    });

    expect(result).toMatchObject({ ok: true });
    expect(importSelfContextFacts).toHaveBeenCalledWith(
      {
        callerUserId: "owner-1",
        provider: "chatgpt",
        text: "```tendnote-context\nwork | normal | I run a software consultancy.\n```",
      },
      expect.any(Function),
    );
  });

  it("charges the model budget, because a paste may reach the extraction model", async () => {
    await importSelfContextFactsAction({ provider: "gemini", text: "anything" });

    expect(enforceProductBudgetSpy).toHaveBeenCalledWith({
      costCategory: "llm-extraction",
      subject: "owner-1",
    });
  });

  it("does not import when the budget is exhausted", async () => {
    const { ProductRateLimitError } = await import("@/lib/rate-limit/guards");
    enforceProductBudgetSpy.mockRejectedValueOnce(
      new ProductRateLimitError({ allowed: false, costCategory: "llm-extraction" } as never),
    );

    const result = await importSelfContextFactsAction({ provider: "chatgpt", text: "anything" });

    expect(result.ok).toBe(false);
    expect(importSelfContextFacts).not.toHaveBeenCalled();
  });

  it("returns owner-facing review rows that carry no raw source id", async () => {
    const result = await importSelfContextFactsAction({ provider: "chatgpt", text: "anything" });

    expect(result).toEqual({
      ok: true,
      view: {
        summary: {
          importId: IMPORT_ID,
          provider: "chatgpt",
          source: "block",
          suggestedCount: 1,
          alreadyPendingCount: 0,
          skippedCount: 0,
          unreadableCount: 0,
        },
        reviews: [
          {
            fact: expect.objectContaining({
              content: "I run a software consultancy.",
              lifecycle: "suggested",
              provenance: { channel: "import", origin: "import" },
            }),
            evidence: FACT.suggestionEvidence,
            activeMatch: null,
          },
        ],
      },
    });
  });

  it("reconciles every scope the import touched", async () => {
    await importSelfContextFactsAction({ provider: "chatgpt", text: "anything" });

    expect(updateTagSpy).toHaveBeenCalledWith("context-facts:owner:owner-1");
    expect(updateTagSpy).toHaveBeenCalledWith("review:owner:owner-1");
    expect(revalidatePathSpy).toHaveBeenCalledWith("/account/about-you");
  });

  it("rejects an unknown provider before reaching the database", async () => {
    const result = await importSelfContextFactsAction({
      provider: "copilot" as never,
      text: "anything",
    });

    expect(result.ok).toBe(false);
    expect(importSelfContextFacts).not.toHaveBeenCalled();
  });

  it("names the limit when a paste is longer than one import may carry", async () => {
    const result = await importSelfContextFactsAction({
      provider: "chatgpt",
      text: "x".repeat(16_001),
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("too long") });
    expect(importSelfContextFacts).not.toHaveBeenCalled();
  });

  it("asks for a paste rather than importing an empty one", async () => {
    const result = await importSelfContextFactsAction({ provider: "chatgpt", text: "   " });

    expect(result).toEqual({ ok: false, error: "Paste what the assistant gave you." });
    expect(importSelfContextFacts).not.toHaveBeenCalled();
  });
});
