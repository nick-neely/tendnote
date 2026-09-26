# Full heavy replay: partial, reconciled

The approved full heavy-only replay stopped on 2026-09-20 at attempted turn 56
(day three). It validated 55 of 600 turns, 27 captures, 32 Follow-Ups, two uploads
and six scheduled checks. The day-two checkpoint and previously failing turn 30
passed. Weekly review and person reuse were not reached. This is not a monthly
cost estimate.

## Failure evidence

The failing assertion was `Expected one new private person-linked source record`.
The final session log records the preceding read-only recall request and response,
then the same `session.waiting` event twice with identical event ID and timestamp.
It contains no receipt of the requested turn-56 capture. This supports a stale
session boundary being accepted by the next `send`, rather than proving another
model capture refusal. The root cause has not yet been reproduced independently.
The runner's generic `Replay subprocess failed (SIGTERM)` metadata is cleanup after
the failed eval; the JUnit/eval assertion above is the actionable failure.

The next repair should reproduce sequential sends through Eve's real client/eval
stream boundary using a deterministic local fixture. It must distinguish stale
waiting events from the current request without resending a mutation, adding an
arbitrary delay, or weakening the database assertion. Review the one stored
General Action before treating this partial sample as behaviorally clean.

There were 34 logged empty-response recovery events across the run. Do not infer
that recovery caused this failure. Raw prompts, replies and traces stay local;
[validation.json](validation.json) preserves content-free observations.

## Reconciliation

All 444 requests settled with one transport attempt each. Provider model request
counts, input/cache tokens, output/reasoning tokens and inference costs match.
There are zero uncertain requests, retained reservations or unfinished background
jobs. No retry or continuation was launched.

| Component | USD |
| --- | ---: |
| Provider inference | 2.06466420 |
| Provider reporting writes | 0.09202500 |
| Provider total | 2.15668920 |
| One reporting-query allowance | 0.00500000 |
| Total including query allowance | **2.16168920** |
| Approved ceiling | 50.00000000 |

The conservative local reporting-write allowance also reserves fees for embeddings;
the provider did not charge reporting writes on those 35 requests.

Storage was 451,331 logical row bytes, including 131,072 uploaded bytes. These
measurements overlap and must not be added. Storage remains unpriced. Web search,
external delivery and infrastructure charges remain excluded.

[Metadata](metadata.json), [ledger](ledger.json), [provider report](provider-report.json),
[reconciliation](reconciliation.json), [category summary](summary.json) and
[heavy progress/storage](heavy.json) preserve the sample. The source passed 22
focused tests, unpaid smoke, affected tests, full verification including build,
and Fallow before the run. Product runtime and eval assertions were unchanged
from the successful canary.
