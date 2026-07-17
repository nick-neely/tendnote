/**
 * Stable, cost-conscious production default for review-gated structured extraction.
 * A dedicated environment override remains available for model evaluation and rollout,
 * but omitting optional tuning must never disable the extraction job families.
 */
export const DEFAULT_EXTRACTION_MODEL = "google/gemini-3.1-flash-lite";

export function resolveExtractionModel(configuredModel?: string) {
  return configuredModel?.trim() || DEFAULT_EXTRACTION_MODEL;
}
