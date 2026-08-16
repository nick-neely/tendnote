# Audit Log Retention Is Internal, Bounded, And Hard-Deleted

The `audit_log` table is internal evidence, not a member-facing activity feed
or a source of product state. Every entry is retained according to a policy
keyed by its `entity_type` and `action`, so a future audit class can receive a
deliberate retention period without changing the storage contract.

## Decision

The current policy keeps every audit entry for two calendar years. The
`household.purge` entry for a dissolved Household Workspace is explicitly
covered by the policy and therefore remains for the two-year period promised by
ADR 0221. Unknown or newly introduced action/entity pairs use the same
two-year default until a more specific rule is reviewed and added.

At the retention deadline, the row is hard-deleted from `audit_log`. There is no
archive or soft-expired state: the audit trail is not the authoritative state of
any product record, and keeping a second copy would only move the retention
problem elsewhere. Existing rows are subject to the same policy when the sweep
first sees them.

Raw audit entries may be read only by internal support, administration, or
operational tooling with its own authorization. Members, former members, and
Household surfaces never receive raw audit rows. In particular, a scrubbed
system actor on a Household purge tombstone does not make the dissolved
Household reappear in a member's owner-scoped history. Existing domain reads of
audit rows remain implementation seams for lifecycle idempotency and undo; they
are not a public audit API.

## Enforcement

The database has an index on `(created_at, id)`. A bounded retention sweep runs
on the existing ten-minute background recovery cron, with a fixed per-pass row
budget. The domain turns each explicit policy and the unknown/default policy
into concrete creation-time ranges. The domain emits a small February 29
exception range when a clamped leap-day deadline would otherwise make the
creation-time order non-monotonic. The store queries those fixed partitions
through the index, caps every partition query, and merges the results by the
domain's canonical expiration deadline before applying the pass cap. An old
long-retention class therefore cannot starve a newer expired class, and the
database never evaluates a computed policy `CASE` across the whole table. It
re-evaluates the action/entity policy immediately before deletion and deletes
each row independently. A row that is already gone or no longer matches the
timestamp fence is skipped; one row's database failure is logged without raw
error details and counted without blocking the rest of the pass. Re-running
the sweep is therefore safe.

The in-memory sweep tests cover policy boundaries, bounded work, and per-row
failure isolation. `pnpm --filter @tendnote/db db:audit-retention:check` also
seeds isolated fixtures in the disposable Postgres database and verifies the
real Drizzle delete and repeat behavior.

The sweep logs only the audit row id, action, entity type, and outcome. It never
logs `metadata_json` or other retained content. The scheduler returns counts for
operational inspection but does not create a user-facing surface.

## Consequences

Audit evidence older than two years is unavailable, including evidence that a
domain might previously have used for a long-lived undo or idempotency lookup.
Such evidence is intentionally not authoritative state; domains must continue
to rely on their durable record when an old audit row is absent. A future policy
that needs a different retention period must add an explicit action/entity rule,
update the policy tests, and verify that the bounded candidate query still
reaches every due class.
