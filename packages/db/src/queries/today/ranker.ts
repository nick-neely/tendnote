import { todayRankingOutputSchema } from "@tendnote/domain";
import { gateway, generateText, Output } from "ai";
import type { TodayOptionalRanker } from "./types";

type TodayRankerEnv = Record<string, string | undefined>;

export function hasTodayRankerCredentials(env: TodayRankerEnv = process.env) {
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

/**
 * Keep local Today loads fast and deterministic unless a developer explicitly
 * opts into the bounded live-ranking path.
 */
export function shouldUseTodayRanker(env: TodayRankerEnv = process.env) {
  return env.NODE_ENV !== "development" || env.TENDNOTE_ENABLE_TODAY_RANKING === "1";
}

export function createAiSdkTodayRanker(
  options: { env?: TodayRankerEnv; model?: string; timeoutMs?: number } = {},
): TodayOptionalRanker {
  const env = options.env ?? process.env;
  const model = options.model ?? env.TENDNOTE_AGENT_MODEL ?? "google/gemini-3.7-flash";
  const timeoutMs = options.timeoutMs ?? 2_000;
  return async (input) => {
    if (!hasTodayRankerCredentials(env)) throw new Error("Eve ranking credentials unavailable.");
    const result = await generateText({
      model: gateway(model),
      abortSignal: AbortSignal.timeout(timeoutMs),
      output: Output.object({
        schema: todayRankingOutputSchema,
        name: "today_optional_ranking",
        description: "A bounded ordering for eligible optional Today items.",
      }),
      system: [
        "You rank only the supplied optional Tendnote Today candidates.",
        "Return only supplied identities. Balance domains where useful.",
        "Do not add urgency, importance, intent, emotion, eligibility, actions, explanations, or new facts.",
      ].join(" "),
      prompt: JSON.stringify({
        localDate: input.localDate,
        candidates: input.candidates.map((candidate) => ({
          identity: candidate.identity,
          family: candidate.family,
          title: candidate.title,
          context: candidate.context,
          factualReason: candidate.reason.explanation,
        })),
      }),
    });
    return result.output;
  };
}
