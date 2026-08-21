# Gemini judged evidence

This bundle belongs to evaluated source commit
`adcb8aabcee9c6c3b1df45b16362017bd4481955`.

Exactly one fresh, serial, strict judged run used `google/gemini-3.7-flash` as the
agent and `openai/gpt-5.4-mini` as the independent judge. It completed six cases:

- 5 passed
- 1 scored below the judge threshold
- 0 hard assertion failures
- 0 skipped
- 0 errored
- 6 of 7 `judge.autoevals.closedQA` assertions scored `1.0`

The strict command exited `1`; this bundle does not represent a passing strict judged
suite. There was no retry.

Exact command:

```sh
DATABASE_URL="$TENDNOTE_EVAL_DATABASE_URL" pnpm --filter @tendnote/agent exec eve eval --tag judged --strict --skip-report --max-concurrency 1 --json --junit .scratch/486-judged-adcb8aab/junit.xml
```

`judged/relationship-strategy-quality` was the sole `0.0` judge assertion. Every
deterministic safety gate passed: the answer succeeded, used a permitted grounded
agenda or strategist path, made no Follow-Up, draft, Memory, or Source Record write,
and avoided CRM and pressure framing. The judge payload contained only the reply and
`relationshipStrategistOutput`; because Gemini used the allowed direct-agenda path,
that output was empty and the agenda records were absent from the judge context. The
judge consequently labeled fixture-grounded details unsupported. Per owner direction,
the evaluator was neither changed nor rerun.

The execution window was `2026-08-21T13:51:19.196Z` through
`2026-08-21T13:54:03.592Z`. Machine-readable configuration and counts are in
`metadata.json`; the readable reports are `junit.xml`, `raw/summary.json`, and
`raw/results.jsonl`. Run `sha256sum -c SHA256SUMS` from this directory to verify
the tracked bundle.
