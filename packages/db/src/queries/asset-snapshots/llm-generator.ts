import {
  type AssetSnapshotInputPack,
  type AssetSnapshotProse,
  buildAssetSnapshotPrompt,
  generateDeterministicAssetSnapshot,
} from "@tendnote/domain";
import type { AssetSnapshotGenerator } from "./types";

/**
 * Provider-agnostic seam for the model call. The composition root (Eve/web) wires a
 * concrete model here; the db package stays free of provider dependencies and the call
 * is trivially fakeable in tests.
 */
export type AssetSnapshotProseModel = (request: { prompt: string }) => Promise<string>;

export type LlmAssetSnapshotGeneratorOptions = {
  model: AssetSnapshotProseModel;
  /** Recorded on snapshots this adapter produces, so provenance names the real producer. */
  version: string;
  /**
   * Used when the model returns empty prose. The fallback declares its own version, so
   * a deterministically-produced snapshot is never mislabeled as model-produced. Model
   * *errors* are deliberately not caught here — they flow to the builder's fail-open
   * path, which records the failure and degrades to the live records.
   */
  fallback?: AssetSnapshotGenerator;
};

/**
 * LLM Asset Snapshot generator. It only turns the visibility-filtered pack into prose:
 * build the prompt, call the model, tag the text with its version. It decides nothing
 * about scope, freshness, persistence, or citations — those stay with the builder, so
 * swapping the generator can never change what a snapshot is grounded on.
 */
export function createLlmAssetSnapshotGenerator(
  options: LlmAssetSnapshotGeneratorOptions,
): AssetSnapshotGenerator {
  const fallback = options.fallback ?? generateDeterministicAssetSnapshot;

  return async (input: AssetSnapshotInputPack): Promise<AssetSnapshotProse> => {
    const summary = (await options.model({ prompt: buildAssetSnapshotPrompt(input) })).trim();

    if (!summary) {
      return fallback(input);
    }

    return { summary, generatorVersion: options.version };
  };
}
