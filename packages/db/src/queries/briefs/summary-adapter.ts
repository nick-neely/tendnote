import {
  type BriefSummaryInput,
  type BriefSummaryResult,
  buildBriefSummaryPrompt,
  generateDeterministicBriefSummary,
} from "@tendnote/domain";

/**
 * The optional decorative summary seam (PRD #65, issue #73). Given the
 * already-selected, presentation-only item context, it returns a summary line and
 * narrow provenance, or null for "no summary". The generator treats a thrown error
 * as fail-open (the brief is still created without a summary), so a model outage
 * never blocks deterministic relationship guidance.
 */
export type BriefSummaryAdapter = (input: BriefSummaryInput) => Promise<BriefSummaryResult | null>;

/**
 * Provider-agnostic seam for the summary model call. The composition root wires a
 * concrete model; the db package stays free of provider dependencies and the call
 * is trivially fakeable in tests.
 */
export type BriefSummaryModel = (request: { prompt: string }) => Promise<string>;

export type LlmBriefSummaryAdapterOptions = {
  model: BriefSummaryModel;
  // Version tag recorded in provenance, typically the model id (e.g. "llm:...").
  version: string;
  // Covers empty/whitespace model output. The fallback declares its own provenance
  // so a deterministic summary is never mislabeled as model-produced. Thrown model
  // errors are intentionally not caught here — they flow to the generator's
  // fail-open path so the brief is created with no summary.
  fallback?: (input: BriefSummaryInput) => BriefSummaryResult;
};

/**
 * LLM summary adapter. It only turns the selected-item context into a line: it
 * builds the prompt, calls the injected model, and tags the result with its
 * version. It never selects items, changes ranks, touches source references, or
 * affects lifecycle — the summary is pure decoration (ADR-0008).
 */
export function createLlmBriefSummaryAdapter(
  options: LlmBriefSummaryAdapterOptions,
): BriefSummaryAdapter {
  const fallback = options.fallback ?? generateDeterministicBriefSummary;

  return async (input) => {
    const text = (await options.model({ prompt: buildBriefSummaryPrompt(input) })).trim();

    if (!text) {
      return fallback(input);
    }

    return { summary: text, provenance: { generator: "llm", version: options.version } };
  };
}
