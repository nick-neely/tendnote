# Interrupted heavy replay

Source: `5e309015166955ccf72b0747e4f5ec8c7a5e29a9`.
Run: `469bf3e9-ce9e-4ae8-be3c-0d0e46a93dac`.

The run started 2026-09-20 at 16:41:46 UTC and last wrote its ledger at
19:06:51 UTC. It validated 225 of 600 turns. Turn 226 was checking outcomes
when execution stopped; it is not counted as validated. This is an incomplete
sample, not a full-month cost baseline.

The ledger's `interrupted` marker is written only by the runner's SIGINT/SIGTERM
handler. The historical handler did not record which signal arrived or its
sender. Available host logs do not establish the sender or an OOM event.
Elapsed time was about 2h25m, below the six-hour eval deadline. There is no
recorded budget, billing or outcome assertion failure at shutdown.

Raw `metadata.json` still says running because shutdown did not reach its final
metadata write. Its values are preserved; JSON whitespace follows repository formatting. The runner and Eve processes were
confirmed absent; `observed-status.json` records the recovered interpretation.
No final storage snapshot or JUnit result was produced.

All 1,814 requests settled, with zero pending or uncertain requests. The single
reserved provider-report query reconciles per-model request counts, input/output
tokens and inference cost. Provider inference was $8.403458555 and reporting
writes $0.375525, totaling $8.778983555. Including the $0.005 query allowance gives
$8.783983555, within the approved $50 ceiling. See `reconciliation.json` and
`provider-report.json`. No additional paid inference was used for investigation.

The sample passed the previous turn-30/56 boundaries, first weekly review and
first person reuse. It does not demonstrate completion of the remaining turns.
Web search and external delivery remained excluded.

The runner now persists signal/time/status before cleanup and tolerates repeated
termination signals while cleanup proceeds. Future long runs should use the
host-owned systemd launch in the [preflight](../../../../docs/phase-9b/heavy-replay-preflight.md).
No launch mechanism can guarantee survival of host shutdown or SIGKILL.
