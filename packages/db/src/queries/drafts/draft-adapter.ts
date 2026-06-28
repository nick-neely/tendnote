import {
  buildDraftPrompt,
  type DraftGenerationResult,
  type DraftGroundedContext,
  generateDeterministicDraft,
} from "@tendnote/domain";

/**
 * The injectable draft-generation seam (PRD #75, issue #77). Given grounded,
 * already-policy-filtered context it returns draft prose and narrow provenance.
 * It is the only place a model is called, so the generator stays deterministic and
 * testable: a fake adapter drives normal verification, and the production default
 * is CI-safe (a deterministic fallback when no model is configured).
 */
export type DraftAdapter = (input: DraftGroundedContext) => Promise<DraftGenerationResult>;

/**
 * Provider-agnostic seam for the drafting model call. The composition root wires a
 * concrete model; the db package stays free of provider dependencies and the call
 * is trivially fakeable.
 */
export type DraftModel = (request: { prompt: string }) => Promise<string>;

export type LlmDraftAdapterOptions = {
  model: DraftModel;
  // Version tag recorded in provenance, typically the model id (e.g. "llm:...").
  version: string;
  // Covers empty/whitespace model output by falling back to the deterministic,
  // source-grounded draft. Thrown model errors are NOT caught here — they flow to
  // the generator's refusal path so a model outage never persists a junk draft.
  fallback?: (input: DraftGroundedContext) => DraftGenerationResult;
};

/**
 * LLM draft adapter. It only turns grounded context into prose: it builds the
 * prompt, calls the injected model, and tags the result with its version. It never
 * selects context, applies privacy policy, or persists anything — that all lives
 * in the generator (PRD #75).
 */
export function createLlmDraftAdapter(options: LlmDraftAdapterOptions): DraftAdapter {
  const fallback = options.fallback ?? generateDeterministicDraft;

  return async (input) => {
    const text = (await options.model({ prompt: buildDraftPrompt(input) })).trim();

    if (!text) {
      return fallback(input);
    }

    return { body: text, provenance: { generator: "llm", version: options.version } };
  };
}
