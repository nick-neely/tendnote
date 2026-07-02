import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({
  judge: { model: process.env.TENDNOTE_JUDGE_MODEL ?? "openai/gpt-5.4-mini" },
  maxConcurrency: 1,
  timeoutMs: 60_000,
});
