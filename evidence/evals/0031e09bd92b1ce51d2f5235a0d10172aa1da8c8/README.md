# Gemini deterministic exploratory evidence

This bundle belongs to evaluated source commit
`0031e09bd92b1ce51d2f5235a0d10172aa1da8c8`.

The serial strict run used `google/gemini-3.7-flash` and completed all 60 selected
deterministic cases: 52 passed, 8 failed, 0 skipped, and 0 errored. It exited `1`.
There was no retry. The owner explicitly accepted this result for model selection;
it is **not** a clean deterministic qualification.

Exact command:

```sh
pnpm --filter @tendnote/agent exec eve eval --tag deterministic --strict --skip-report --max-concurrency 1 --json --junit .scratch/486-extra-model-comparison/google__gemini-3.7-flash/junit.xml
```

The execution window was `2026-08-21T04:12:27.135Z` through
`2026-08-21T04:24:24.334Z`. Machine-readable configuration and counts are in
`metadata.json`; the readable reports are `junit.xml`, `raw/summary.json`, and
`raw/results.jsonl`. Run `sha256sum -c SHA256SUMS` from this directory to verify
the tracked bundle.
