import {
  type SuggestedMemoryExtractionAdapter,
  type SuggestedMemoryExtractionAdapterResult,
  type SuggestedMemoryExtractionInput,
  suggestedMemoryExtractionAdapterResultSchema,
  suggestedMemoryExtractionPromptVersion,
} from "@tendnote/domain";
import { gateway, generateText, Output } from "ai";

type SuggestedMemoryExtractionEnv = Record<string, string | undefined>;

export type AiSdkSuggestedMemoryExtractionAdapterOptions = {
  model?: string;
  promptVersion?: string;
  env?: SuggestedMemoryExtractionEnv;
};

export function hasSuggestedMemoryExtractionCredentials(
  env: SuggestedMemoryExtractionEnv = process.env,
) {
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

export function shouldRunLiveSuggestedMemoryExtractionSmoke(
  env: SuggestedMemoryExtractionEnv = process.env,
) {
  return (
    env.TENDNOTE_RUN_LIVE_EXTRACTION_SMOKE === "1" &&
    Boolean(env.TENDNOTE_EXTRACTION_MODEL) &&
    hasSuggestedMemoryExtractionCredentials(env)
  );
}

function configuredExtractionModel(options: AiSdkSuggestedMemoryExtractionAdapterOptions) {
  return options.model?.trim() || options.env?.TENDNOTE_EXTRACTION_MODEL?.trim();
}

function requireExtractionModel(options: AiSdkSuggestedMemoryExtractionAdapterOptions) {
  const model = configuredExtractionModel(options);

  if (!model) {
    throw new Error("Missing TENDNOTE_EXTRACTION_MODEL for suggested-memory extraction.");
  }

  return model;
}

function requireExtractionCredentials(env: SuggestedMemoryExtractionEnv) {
  if (!hasSuggestedMemoryExtractionCredentials(env)) {
    throw new Error(
      "Missing AI Gateway credentials for suggested-memory extraction. Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.",
    );
  }
}

function formatPeople(input: SuggestedMemoryExtractionInput) {
  return input.resolvedPeople.map((person) => `- ${person.displayName}: ${person.id}`).join("\n");
}

function buildPrompt(input: SuggestedMemoryExtractionInput) {
  return [
    "Extract zero or more tentative suggested memories from this retained source record.",
    "",
    "Only use facts directly stated in the source record. Do not infer unstated intentions, relationships, birthdays, jobs, medical details, or future plans.",
    "Split distinct durable facts into small atomic candidates. Return zero candidates when the note has no durable relationship context.",
    "Each candidate must use exactly one resolved person id from the list below. Do not create people and do not use unresolved mentions.",
    "Use bounded metadata only when useful: memoryType, importance, confidence, and sensitivity.",
    "",
    "Resolved people:",
    formatPeople(input) || "- none",
    "",
    "Source record:",
    input.sourceRecord.content,
  ].join("\n");
}

export function createAiSdkSuggestedMemoryExtractionAdapter(
  options: AiSdkSuggestedMemoryExtractionAdapterOptions = {},
): SuggestedMemoryExtractionAdapter {
  const env = options.env ?? process.env;
  const promptVersion = options.promptVersion ?? suggestedMemoryExtractionPromptVersion;

  return {
    kind: "llm",
    model: configuredExtractionModel(options),
    promptVersion,
    async extractCandidates(input): Promise<SuggestedMemoryExtractionAdapterResult> {
      const model = requireExtractionModel(options);
      requireExtractionCredentials(env);

      const result = await generateText({
        model: gateway(model),
        output: Output.object({
          schema: suggestedMemoryExtractionAdapterResultSchema,
          name: "suggested_memory_extraction",
          description:
            "Atomic tentative suggested-memory candidates grounded in one source record.",
        }),
        system:
          "You extract tentative suggested memories for Tendnote. Suggestions are review items, not confirmed facts.",
        prompt: buildPrompt(input),
      });

      return result.output;
    },
  };
}

export function createDefaultSuggestedMemoryExtractionAdapter(
  env: SuggestedMemoryExtractionEnv = process.env,
): SuggestedMemoryExtractionAdapter {
  return createAiSdkSuggestedMemoryExtractionAdapter({
    env,
    model: env.TENDNOTE_EXTRACTION_MODEL,
    promptVersion: env.TENDNOTE_EXTRACTION_PROMPT_VERSION ?? suggestedMemoryExtractionPromptVersion,
  });
}
