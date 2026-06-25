import {
  buildSnapshotPrompt,
  generateDeterministicSnapshot,
  type SnapshotInputPack,
  type SnapshotProse,
} from "@tendnote/domain";
import type { SnapshotGenerator } from "./builder";

/**
 * Provider-agnostic seam for the model call. The composition root (Eve/web) wires
 * a concrete model here; the db package stays free of provider dependencies and
 * the call is trivially fakeable in tests.
 */
export type SnapshotProseModel = (request: { prompt: string }) => Promise<string>;

export type LlmSnapshotGeneratorOptions = {
  model: SnapshotProseModel;
  // Version tag recorded on snapshots this adapter produces — typically the model
  // identifier (e.g. "llm:claude-..."), so persisted provenance reflects the model.
  version: string;
  // Used when the model returns empty/whitespace prose, for local confidence. The
  // fallback declares its own version, so a snapshot produced by the fallback is
  // never mislabeled as model-produced. Model errors are intentionally not caught
  // here — they flow to the builder's fail-open path (#13).
  fallback?: SnapshotGenerator;
};

/**
 * LLM snapshot generator adapter (PRD #11, ADR 0009). It only turns the
 * policy-filtered input pack into prose: it builds the prompt, calls the injected
 * model, and returns the text tagged with its version. It does not decide owner
 * scope, freshness, persistence, supporting references, or policy filtering —
 * those stay with the shared builder. A deterministic fallback covers empty model
 * output; thrown model errors propagate so the builder fails open to Phase 1A
 * context.
 */
export function createLlmSnapshotGenerator(
  options: LlmSnapshotGeneratorOptions,
): SnapshotGenerator {
  const fallback = options.fallback ?? generateDeterministicSnapshot;

  return async (input: SnapshotInputPack): Promise<SnapshotProse> => {
    const summary = (await options.model({ prompt: buildSnapshotPrompt(input) })).trim();

    if (!summary) {
      return fallback(input);
    }

    return { summary, generatorVersion: options.version };
  };
}
