# Heavy canary: complete

The approved $10 canary passed all 40 turns across two daily sessions on
2026-09-20. The previously failing turn 30 created its required private,
person-linked Source Record. This is one two-day sample, not a completed
600-turn heavy month or a monthly cost estimate.

| Validated activity | Count |
| --- | ---: |
| Turns | 40 |
| Captures | 20 |
| Follow-Ups | 25 |
| Uploads | 2 |
| Scheduled checks | 6 |
| Seeded people | 150 |

Runtime logs recorded 26 empty-response recovery events. Every required outcome
passed despite those recoveries. All 337 requests settled with one transport
attempt each; there are zero uncertain requests, retained reservations,
unfinished background jobs, or Saved Items. This does not establish a future
failure rate or validate later weekly reviews and person reuse.

## Reconciled cost

| Component | USD |
| --- | ---: |
| Provider inference | 1.51530728 |
| Provider reporting writes | 0.07020000 |
| Provider total | 1.58550728 |
| One reporting-query allowance | 0.00500000 |
| Total including query allowance | **1.59050728** |
| Approved ceiling | 10.00000000 |

The single provider report matches all model request counts, input tokens
including cache tokens, output tokens including reasoning tokens, and inference
costs. The conservative local write allowance includes embeddings; the provider
charged no reporting writes for those 25 requests. The query allowance is kept
separate from the reported model charges.

Storage was 344,930 logical row bytes, including 131,072 uploaded bytes. These
are overlapping measurements and must not be added together. Storage is measured
but unpriced. Web search, external delivery and infrastructure charges are
excluded from this isolated baseline.

## Evidence and next boundary

- [Metadata](metadata.json): source, run ID, timestamps and exclusions.
- [Validation](validation.json): outcomes, recovery count and limitations.
- [Reconciliation](reconciliation.json): per-model matching and totals.
- [Provider report](provider-report.json): content-free reporting rows.
- [Ledger](ledger.json): request settlement and conservative allowances.
- [Category summary](summary.json) and [heavy results](heavy.json).

The runtime repair and canary runner passed focused tests, unpaid smoke,
agent typechecking, affected tests, full verification including build, and
Fallow before this run. No outcome assertions were relaxed.

Next is preparation of a full heavy-only replay with its own approved ceiling,
fresh isolated database, and day-two, day-seven and day-eight checkpoints.
No additional paid run was started. Earlier light/typical evidence remains at
its original source and must disclose the runtime difference in a combined report.
