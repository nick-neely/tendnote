import {
  type SuggestedActionExtractionAdapter,
  type SuggestedActionExtractionAdapterResult,
  type SuggestedActionExtractionInput,
  suggestedActionExtractionAdapterResultSchema,
  suggestedActionExtractionPromptVersion,
} from "@tendnote/domain";
import { gateway, generateText, Output } from "ai";
import { resolveExtractionModel } from "../extraction-model";

type SuggestedActionExtractionEnv = Record<string, string | undefined>;

export type AiSdkSuggestedActionExtractionAdapterOptions = {
  model?: string;
  promptVersion?: string;
  env?: SuggestedActionExtractionEnv;
};

export function hasSuggestedActionExtractionCredentials(
  env: SuggestedActionExtractionEnv = process.env,
) {
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

function requireExtractionCredentials(env: SuggestedActionExtractionEnv) {
  if (!hasSuggestedActionExtractionCredentials(env)) {
    throw new Error(
      "Missing AI Gateway credentials for suggested-action extraction. Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.",
    );
  }
}

function formatPeople(input: SuggestedActionExtractionInput) {
  return input.resolvedPeople.map((person) => `- ${person.displayName}: ${person.id}`).join("\n");
}

function formatAreas(input: SuggestedActionExtractionInput) {
  return input.availableAreas.map((area) => `- ${area.name}: ${area.id}`).join("\n");
}

function buildPrompt(input: SuggestedActionExtractionInput) {
  return [
    "Extract zero or more actionable to-dos from this captured source record.",
    "",
    "Only propose an action when the note clearly implies something the user should do or maintain (a task, an errand, a recurring chore). Return zero candidates when the note is not action-like.",
    "Each candidate needs a short imperative title. Optionally add: a one-line reason, coarse priority (low/normal/high), coarse effort (small/medium/large), a due date, a defer date, a simple recurrence (interval + unit for a recurring chore), asset hints (plain subject labels like 'refrigerator water filter'), person links (only ids from the list below), an area id (only from the list below), and scope (private or household).",
    "Do not invent people or areas. Default scope to private; only use household when the note is clearly a shared-household task.",
    "",
    "Resolved people:",
    formatPeople(input) || "- none",
    "",
    "Areas:",
    formatAreas(input) || "- none",
    "",
    "Source record:",
    input.sourceRecord.content,
  ].join("\n");
}

/**
 * LLM action extraction adapter, mirroring the suggested-memory adapter's model-call
 * pattern (AI Gateway via the `ai` SDK). It returns a loose candidate envelope; the
 * shared domain validator enforces the real candidate contract and drops unknown people
 * and areas, so a hallucinated id can never leak into a proposal.
 */
export function createAiSdkSuggestedActionExtractionAdapter(
  options: AiSdkSuggestedActionExtractionAdapterOptions = {},
): SuggestedActionExtractionAdapter {
  const env = options.env ?? process.env;
  const promptVersion = options.promptVersion ?? suggestedActionExtractionPromptVersion;
  const model = resolveExtractionModel(options.model ?? env.TENDNOTE_EXTRACTION_MODEL);

  return {
    kind: "llm",
    model,
    promptVersion,
    async extractActions(input): Promise<SuggestedActionExtractionAdapterResult> {
      requireExtractionCredentials(env);

      const result = await generateText({
        model: gateway(model),
        output: Output.object({
          schema: suggestedActionExtractionAdapterResultSchema,
          name: "suggested_action_extraction",
          description: "Actionable to-do candidates distilled from one source record.",
        }),
        system:
          "You extract review-gated action suggestions for Tendnote. Suggestions are proposals the user reviews, never active tasks.",
        prompt: buildPrompt(input),
      });

      return result.output;
    },
  };
}

export function createDefaultSuggestedActionExtractionAdapter(
  env: SuggestedActionExtractionEnv = process.env,
): SuggestedActionExtractionAdapter {
  return createAiSdkSuggestedActionExtractionAdapter({
    env,
    model: env.TENDNOTE_EXTRACTION_MODEL,
    promptVersion:
      env.TENDNOTE_ACTION_EXTRACTION_PROMPT_VERSION ?? suggestedActionExtractionPromptVersion,
  });
}
