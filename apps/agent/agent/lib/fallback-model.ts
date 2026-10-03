/**
 * The models interactive Eve may fall back to over its Fair-Use Budget
 * (`docs/phase-9b/production-and-fallback-models.md`): GPT-6 Luna, and Gemini
 * 3.1 Flash Lite, the named alternate if Luna fails qualification.
 */
const FALLBACK_MODELS = ["openai/gpt-6-luna", "google/gemini-3.1-flash-lite"] as const;

/**
 * The Fallback Model, from `TENDNOTE_FALLBACK_MODEL`. Only the two named models
 * are accepted, so an unqualified model cannot be configured in silently; any
 * other value fails at startup.
 */
export function interactiveFallbackModelId(
  configured = process.env.TENDNOTE_FALLBACK_MODEL,
): string {
  const modelId = configured?.trim() || FALLBACK_MODELS[0];
  if (!(FALLBACK_MODELS as readonly string[]).includes(modelId)) {
    throw new Error(
      `TENDNOTE_FALLBACK_MODEL must be ${FALLBACK_MODELS.join(" or ")}; got ${modelId}.`,
    );
  }
  return modelId;
}
