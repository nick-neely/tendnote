# Accepted Gemini evaluation record

This record documents the model decision explicitly accepted for issue #486. It is
not a claim that the deterministic publication qualifier passed.

## Candidate and configuration

- Default-model candidate: `adcb8aabcee9c6c3b1df45b16362017bd4481955`
- Agent model: `google/gemini-3.7-flash`
- Judge model for the judged suite: `openai/gpt-5.4-mini`
- Retry status: no judged retry

## Deterministic exploratory comparison

The preserved Gemini comparison ran against source candidate
`0031e09bd92b1ce51d2f5235a0d10172aa1da8c8` and completed 60 cases:

- 52 passed
- 8 failed
- 0 skipped
- 0 errored

The owner explicitly accepted this exploratory result without requiring a 60/60
qualification and directed the program to proceed with Gemini. It therefore remains
accepted model-selection evidence, not clean deterministic qualification evidence.

Local preserved source files and SHA-256 checksums:

| File | SHA-256 |
| --- | --- |
| `.scratch/486-extra-model-comparison/google__gemini-3.7-flash/eval.log` | `36fa7f028712d9a3b60fac90733f34aa75d91a887554a43d29461f8ed0ec69d7` |
| `.scratch/486-extra-model-comparison/google__gemini-3.7-flash/junit.xml` | `158670a79f49d7dc6d015b3b495e1ac7e10561217648ee8001836cdf11f49a7f` |
| `.scratch/486-extra-model-comparison/google__gemini-3.7-flash/prepare.log` | `b1b2fa1a5ca3baf0e224733b82841ca2fdb3ef6648f86ea2b6888d6ebd5876c2` |

## Judged suite

Exactly one fresh, serial, strict judged run was performed against the committed
default-model candidate. It completed six cases with no runtime failures, skips, or
errors:

- 5 passed
- 1 scored below its soft judge threshold
- 0 hard assertion failures
- 0 skipped
- 0 errored
- 6 of 7 `judge.autoevals.closedQA` assertions scored `1.0`

`judged/relationship-strategy-quality` was the sole `0.0` judge assertion. Every
deterministic safety gate passed: the answer succeeded, used a permitted grounded
agenda or strategist path, made no Follow-Up, draft, Memory, or Source Record write,
and avoided CRM and pressure framing. The judge payload contained only the reply and
`relationshipStrategistOutput`; because Gemini used the allowed direct-agenda path,
that output was empty and the agenda records were absent from the judge context. The
judge consequently labeled fixture-grounded details unsupported. Per owner direction,
the evaluator was neither changed nor rerun.

Local preserved source files and SHA-256 checksums:

| File | SHA-256 |
| --- | --- |
| `.scratch/486-judged-adcb8aab/results.json` | `5a5917c2158c5bb77cee7ffed907aed4949f1c0c8a93318c7d7a3377ed6288ce` |
| `.scratch/486-judged-adcb8aab/junit.xml` | `a595de565708fc55e4b7a27798ad817acbd6bfda384303ebdfa63ef3cde57900` |
| `.scratch/486-judged-adcb8aab/prepare.log` | `cdd886501384a08109795fa5710c78063ad3719b9e6157c7b3d94f4ac8af4fea` |
| `.scratch/486-judged-adcb8aab/eval.stderr.log` | `0e1c50a56f8928c46daf9aae317b19d550f05377c504d9e0cc8e3721544dd268` |
| `.scratch/486-judged-adcb8aab/status.tsv` | `f05a5b1b3a2e57239fd30ce027cc9a356283f39b1d8834decbf0684a340fb508` |
