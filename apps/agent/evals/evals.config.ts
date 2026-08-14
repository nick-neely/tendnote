import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({
  judge: { model: process.env.TENDNOTE_JUDGE_MODEL ?? "openai/gpt-5.4-mini" },
  // One at a time, and not for rate limiting: every eval runs against the same
  // prepared `tendnote_eval` database, and several of them write to it. Two evals
  // in flight would let one eval's capture or mutation land in another's read.
  maxConcurrency: 1,
  // The single-turn budget. Multi-turn evals set their own `timeoutMs` at roughly
  // this much per turn rather than raising the default for everyone.
  timeoutMs: Number(process.env.TENDNOTE_EVAL_TIMEOUT_MS ?? 60_000),
});
