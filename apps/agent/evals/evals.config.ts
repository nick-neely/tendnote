import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({
  judge: { model: process.env.TENDNOTE_JUDGE_MODEL ?? "openai/gpt-5.4-mini" },
  maxConcurrency: 1,
  timeoutMs: Number(process.env.TENDNOTE_EVAL_TIMEOUT_MS ?? 60_000),
});
