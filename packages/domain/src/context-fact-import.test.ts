import { describe, expect, it } from "vitest";
import {
  buildContextFactImportPrompt,
  buildContextFactImportProviderLink,
  CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE,
  contextFactImportEvidence,
  contextFactImportProvider,
  contextFactImportProviders,
  hasReadableContextFactImportBlock,
  MAX_CONTEXT_FACT_IMPORT_CANDIDATES,
  MAX_CONTEXT_FACT_IMPORT_EVIDENCE_LENGTH,
  parseContextFactImportBlock,
  validateContextFactImportCandidates,
} from "./context-fact-import";

const chatgpt = contextFactImportProvider("chatgpt");
const claude = contextFactImportProvider("claude");

function block(...lines: string[]) {
  return ["```" + CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE, ...lines, "```"].join("\n");
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    category: "work",
    content: "I run a software consultancy.",
    evidence: 'From your ChatGPT memory: "I run a software consultancy."',
    sensitivity: "normal",
    ...overrides,
  };
}

describe("buildContextFactImportPrompt", () => {
  it("names the return url, the block language, and every self category", () => {
    const prompt = buildContextFactImportPrompt({
      returnUrl: "https://tendnote.test/account/about-you/import",
    });

    expect(prompt).toContain("https://tendnote.test/account/about-you/import");
    expect(prompt).toContain("```" + CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE);
    for (const category of ["background", "work", "location", "interest", "preference"]) {
      expect(prompt).toContain(category);
    }
  });

  it("refuses the content Context Facts must never hold", () => {
    const prompt = buildContextFactImportPrompt({ returnUrl: "https://tendnote.test/import" });

    expect(prompt).toContain("street address");
    expect(prompt).toContain("Never invent a fact");
    expect(prompt).toContain("anything about other people");
  });

  it("stays short enough to survive a prefilled chat url", () => {
    const link = buildContextFactImportProviderLink(
      chatgpt,
      buildContextFactImportPrompt({ returnUrl: "https://tendnote.test/account/about-you/import" }),
    );

    expect(link.prefilled).toBe(true);
  });
});

describe("buildContextFactImportProviderLink", () => {
  it("prefills the composer for the one provider that reads a prompt parameter", () => {
    const link = buildContextFactImportProviderLink(chatgpt, "hello there");

    expect(link.prefilled).toBe(true);
    expect(new URL(link.href).searchParams.get("q")).toBe("hello there");
  });

  it("opens a plain new chat when the provider has no prompt parameter", () => {
    const link = buildContextFactImportProviderLink(claude, "hello there");

    expect(link).toEqual({ href: claude.newChatUrl, prefilled: false });
  });

  it("degrades to copy-then-open rather than send a truncated prompt", () => {
    const link = buildContextFactImportProviderLink(chatgpt, "x".repeat(7_000));

    expect(link).toEqual({ href: chatgpt.newChatUrl, prefilled: false });
  });

  it("keeps every provider on an https chat url", () => {
    for (const provider of contextFactImportProviders) {
      expect(new URL(provider.newChatUrl).protocol).toBe("https:");
    }
  });
});

describe("parseContextFactImportBlock", () => {
  it("returns null when the paste carries no block, so the caller can fall back", () => {
    expect(parseContextFactImportBlock("I think you like trail running.", chatgpt)).toBeNull();
  });

  it("reads every well-formed line and grounds it in the named provider", () => {
    const parsed = parseContextFactImportBlock(
      ["Here you go!", block("work | normal | I run a software consultancy."), "Copy that."].join(
        "\n",
      ),
      chatgpt,
    );

    expect(parsed?.unreadableLineCount).toBe(0);
    expect(parsed?.candidates).toEqual([
      {
        category: "work",
        content: "I run a software consultancy.",
        evidence: 'From your ChatGPT memory: "I run a software consultancy."',
        sensitivity: "normal",
      },
    ]);
  });

  it("counts lines it cannot read instead of guessing at them", () => {
    const parsed = parseContextFactImportBlock(
      block(
        "work | normal | I run a software consultancy.",
        "I am based in Chicago.",
        "nonsense | normal | I like trail running.",
        "work | loud | I write software.",
        "",
      ),
      chatgpt,
    );

    expect(parsed?.candidates).toHaveLength(1);
    expect(parsed?.unreadableLineCount).toBe(3);
  });

  it("reads a block the assistant left unterminated", () => {
    const parsed = parseContextFactImportBlock(
      [
        "```" + CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE,
        "location | normal | I am based in Chicago.",
      ].join("\n"),
      chatgpt,
    );

    expect(parsed?.candidates).toHaveLength(1);
  });

  it("only calls a block readable when it yields a fact the import can use", () => {
    // The surface promises "your paste never leaves the app" on this answer, so it
    // has to match what the import does rather than merely spotting the fence.
    expect(hasReadableContextFactImportBlock(block("work | normal | I run a consultancy."))).toBe(
      true,
    );
    expect(
      hasReadableContextFactImportBlock(block("I run a consultancy.", "based in Chicago")),
    ).toBe(false);
    expect(hasReadableContextFactImportBlock("I mention ```tendnote-context in passing.")).toBe(
      false,
    );
    expect(hasReadableContextFactImportBlock("You run a consultancy.")).toBe(false);
  });

  it("reads the rows an assistant's own copy button hands over", () => {
    // Every provider renders the block with its own copy button, and that button
    // copies the block's contents - so the paste an owner actually makes has no
    // fence around it. This is the common case, not the exception.
    const copied = [
      "work | normal | I work remotely as a software consultant.",
      "location | normal | I'm based in Dubuque, Iowa.",
      "other | normal | I have three cats.",
    ].join("\n");

    const parsed = parseContextFactImportBlock(copied, chatgpt);

    expect(parsed?.candidates).toHaveLength(3);
    expect(parsed?.unreadableLineCount).toBe(0);
    expect(hasReadableContextFactImportBlock(copied)).toBe(true);
  });

  it("ignores the prose an assistant wraps around unfenced rows", () => {
    const parsed = parseContextFactImportBlock(
      [
        "Here's what I remember about you:",
        "work | normal | I run a software consultancy.",
        "",
        "Copy the block above, then open http://localhost:3000/account/about-you/import and paste it in.",
      ].join("\n"),
      chatgpt,
    );

    // Only a line carrying a pipe was trying to be a row, so the surrounding
    // sentences are not reported back as lines Tendnote could not read.
    expect(parsed?.candidates).toHaveLength(1);
    expect(parsed?.unreadableLineCount).toBe(0);
  });

  it("still counts a malformed row when it was unfenced", () => {
    const parsed = parseContextFactImportBlock(
      ["work | normal | I run a consultancy.", "nonsense | normal | I like trail running."].join(
        "\n",
      ),
      chatgpt,
    );

    expect(parsed?.candidates).toHaveLength(1);
    expect(parsed?.unreadableLineCount).toBe(1);
  });

  it("returns null for prose that holds no rows at all", () => {
    expect(parseContextFactImportBlock("I think you like trail running.", chatgpt)).toBeNull();
    expect(parseContextFactImportBlock("Sorry, I don't remember anything.", chatgpt)).toBeNull();
  });

  it("keeps a pipe inside the statement out of the field split", () => {
    const parsed = parseContextFactImportBlock(
      block("preference | normal | I prefer concise answers | short ones."),
      chatgpt,
    );

    expect(parsed?.candidates).toHaveLength(0);
    expect(parsed?.unreadableLineCount).toBe(1);
  });
});

describe("validateContextFactImportCandidates", () => {
  it("keeps a durable first-person statement", () => {
    const result = validateContextFactImportCandidates({ candidates: [candidate()] });

    expect(result.rejectedCandidateCount).toBe(0);
    expect(result.validCandidates).toHaveLength(1);
  });

  it("rejects a precise address rather than let it reach storage", () => {
    const result = validateContextFactImportCandidates({
      candidates: [
        candidate({
          category: "location",
          content: "I live at 1400 Maple Street, Chicago 60601.",
          evidence: 'From your ChatGPT memory: "I live at 1400 Maple Street, Chicago 60601."',
        }),
      ],
    });

    expect(result.validCandidates).toHaveLength(0);
    expect(result.rejectedCandidateCount).toBe(1);
  });

  it("rejects a raw secret disclosure", () => {
    const result = validateContextFactImportCandidates({
      candidates: [
        candidate({
          category: "other",
          content: "My bank account number is 12345678.",
          evidence: 'From your ChatGPT memory: "My bank account number is 12345678."',
        }),
      ],
    });

    expect(result.validCandidates).toHaveLength(0);
  });

  it("rejects a time-bound statement", () => {
    const result = validateContextFactImportCandidates({
      candidates: [
        candidate({
          content: "I am currently between contracts.",
          evidence: 'From your ChatGPT memory: "I am currently between contracts."',
        }),
      ],
    });

    expect(result.validCandidates).toHaveLength(0);
  });

  it("rejects an inferred persona", () => {
    const result = validateContextFactImportCandidates({
      candidates: [
        candidate({
          category: "other",
          content: "The user seems to enjoy long technical discussions.",
          evidence: 'From your ChatGPT memory: "The user seems to enjoy long discussions."',
        }),
      ],
    });

    expect(result.validCandidates).toHaveLength(0);
  });

  it("rejects a self-assessment, which orients nothing", () => {
    const result = validateContextFactImportCandidates({
      candidates: [
        candidate({
          category: "other",
          content: "I am good at negotiation.",
          evidence: 'From your ChatGPT memory: "I am good at negotiation."',
        }),
        candidate({
          category: "other",
          content: "I value directness above all else.",
          evidence: 'From your ChatGPT memory: "I value directness."',
        }),
      ],
    });

    expect(result.validCandidates).toHaveLength(0);
    expect(result.rejectedCandidateCount).toBe(2);
  });

  it("keeps a durable habit that ambient extraction would have refused", () => {
    const result = validateContextFactImportCandidates({
      candidates: [
        candidate({
          category: "preference",
          content: "I am vegetarian.",
          evidence: 'From your ChatGPT memory: "I am vegetarian."',
        }),
      ],
    });

    expect(result.validCandidates).toHaveLength(1);
  });

  it("raises sensitivity to match the evidence and never lowers it", () => {
    const result = validateContextFactImportCandidates({
      candidates: [
        candidate({
          category: "constraint",
          content: "I schedule around a medical appointment each month.",
          evidence: 'From your ChatGPT memory: "I schedule around a medical appointment."',
          sensitivity: "normal",
        }),
        candidate({
          category: "interest",
          content: "I follow trail running.",
          evidence: 'From your ChatGPT memory: "I follow trail running."',
          sensitivity: "sensitive",
        }),
      ],
    });

    expect(result.validCandidates.map((entry) => entry.sensitivity)).toEqual([
      "restricted",
      "sensitive",
    ]);
  });

  it("collapses a statement the assistant listed twice", () => {
    const result = validateContextFactImportCandidates({
      candidates: [
        candidate(),
        candidate({ content: "I  run a Software Consultancy!" }),
        candidate({ category: "background" }),
      ],
    });

    expect(result.validCandidates).toHaveLength(2);
    expect(result.rejectedCandidateCount).toBe(1);
  });

  it("bounds one import to a reviewable batch", () => {
    const oversized = Array.from({ length: MAX_CONTEXT_FACT_IMPORT_CANDIDATES + 3 }, (_, index) =>
      candidate({
        category: "interest",
        content: `I follow subject number ${index}.`,
        evidence: `From your ChatGPT memory: "I follow subject number ${index}."`,
      }),
    );

    const result = validateContextFactImportCandidates({ candidates: oversized });

    expect(result.validCandidates).toHaveLength(MAX_CONTEXT_FACT_IMPORT_CANDIDATES);
    expect(result.rejectedCandidateCount).toBe(3);
  });

  it("treats a malformed adapter payload as one rejection, not a throw", () => {
    expect(validateContextFactImportCandidates("not an object")).toEqual({
      validCandidates: [],
      rejectedCandidateCount: 1,
    });
  });
});

describe("contextFactImportEvidence", () => {
  it("names the source and quotes the statement", () => {
    expect(contextFactImportEvidence("Gemini", "I run a software consultancy.")).toBe(
      'From your Gemini memory: "I run a software consultancy."',
    );
  });

  it("stays inside the evidence bound for a long statement", () => {
    const evidence = contextFactImportEvidence("ChatGPT", "x".repeat(600));

    expect(evidence.length).toBeLessThanOrEqual(MAX_CONTEXT_FACT_IMPORT_EVIDENCE_LENGTH);
  });
});
