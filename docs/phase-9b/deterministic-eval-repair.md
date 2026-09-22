# Local deterministic eval repair and evidence

The investigation for [Package the clean local deterministic eval run as evidence](https://github.com/nick-neely/tendnote/issues/579)
found complete historical runs, but no clean full-suite artifact. On September
22, 2026, the owner authorized harness repairs and fresh local execution.

| Candidate | Scope | Result | Evidence |
| --- | --- | --- | --- |
| `af5930ab` | 60 cases, 60-second timeout | 53 passed, 7 failed (including 3 timeouts) | [First pass](../../evidence/evals/af5930ab9bae0a4d7ed0d1fad296a35035f47a49/README.md) |
| `07d98cdf` | 60 cases, 180-second timeout | 59 passed, 1 failed, no errors | [Second pass](../../evidence/evals/07d98cdf54d6c1658eec0a7e842568684632a0cc/README.md) |
| `68569444` | One corrected priority/alert case | 1 passed, no errors | [Focused confirmation](../../evidence/evals/68569444802c33a1011b865d0809f7435371bb08/README.md) |

The first pass exposed four approval-scope false negatives: the final approval
response retained tool results but not the original tool inputs. Session
assertion checkpoints preserve those inputs without weakening the expected
actions. The other three failures were timeouts. All seven passed in the
second full run.

The second run's only failure matched `I set the alert` inside the question
`what time should I set the alert for?`. The narrow matcher repair passes that
question while still rejecting completed-action claims. The focused live
confirmation passed. No observed failure in these runs established a model
behavior violation; that does not establish model reliability beyond this
sample.

Lifecycle fixture dates now stay in the future. The evidence packager also
reads Eve 0.47's model identity from step events, preserving compatibility
with older session identity events and rejecting conflicting identities.
Regression tests reproduce both assertion failures and reject incorrect tool
inputs or unauthorized-action claims.

All runs used Gemini 3.7 Flash, patched Eve 0.47.7, a freshly seeded synthetic
local database, serial execution, disabled schedules and built-in provider
web search, and no external transports. They do not qualify those excluded
integrations. Total provider charges were $7.17983605; including the reserved
reporting-write allowance, the total was $7.38166105. All 897 requests settled
under a cumulative $10 cap. A third full pass was not started because its
observed cost of about $3.66 would exceed the remaining allowance.

The strict clean-full-run prerequisite remains open. The final candidate has
only a focused live confirmation. Do not merge passes across candidates into
a claimed 60/60 first sample. A separately budgeted complete run of the final
candidate is the remaining evidence step, estimated at roughly $3.70 and
30 minutes from these two local samples.

Validation after the final repair: `pnpm verify`, `pnpm coverage:ci`, and
`FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci` passed. All bundle checksums are
preserved; original failed verdicts remain unchanged.
