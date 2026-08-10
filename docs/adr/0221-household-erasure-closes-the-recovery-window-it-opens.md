# Household Erasure Closes the Recovery Window It Opens

Household Dissolution ends access immediately and opens a thirty-day window in
which support can put the household back. That window now closes by deleting
rather than by lapsing: a bounded background sweep permanently removes a
dissolved Household Workspace and every record the workspace itself owns once
the deadline has passed, and it is the same deadline the copy promises, computed
once in the domain and read from both ends. Recovery ceasing to be offered and
content ceasing to exist are deliberately the same moment. A gap between them
would be a period in which Tendnote holds a household's content it has already
told every member it can no longer restore, and product copy may now say plainly
that what the household held is deleted.

The sweep disposes only of what the Household Workspace owns and releases
everything else. A household-native record belongs to the workspace, so it goes;
a member-owned record never belonged to the household however long it sat in
one, so it returns to `private` with its household link cleared and its
optimistic-concurrency fence bumped. Releasing rather than deleting is also the
only correct reading of the schema: the member-owned tables clear their
`household_id` on delete, and a `household`-scope record pointing at no
household is readable by nobody, its own owner included. Provider-cache material
is named and removed explicitly rather than left to a foreign key, because a
sweep whose inventory is whatever the database happens to cascade cannot report
what it removed.

What survives is a single minimized non-content tombstone per household,
recording the two moments, the outcome, and how much of each family moved, with
a scrubbed system actor rather than a member id: no person decided this, the
deadline did, and filing the entry against a member would make a household they
long since left reappear on their own audit path. The disposal order is a fact
about the schema's constraints rather than about SQL, so it lives in the service
as data that a store with no database can execute and refuse, and the same order
is confirmed against a real Postgres by `pnpm --filter @tendnote/db db:purge:check`.

The sweep rides the existing ten-minute background cron rather than a schedule
of its own, bounded to a few households per pass and running last: a thirty-day
deadline does not need its own timer, a second cron entry would be a second
place for the deletion promise to be switched off, and a run that is short of
budget should spend what remains on work that can be retried before it spends
any on work that cannot be undone. Each household is erased in one transaction
with per-household error isolation, so a failure leaves that household whole for
the next pass rather than half-deleted.

Open item, deliberately not built here: the audit trail's own two-year
expiry. `audit_log` has no retention mechanism today, so the tombstone this
decision creates currently persists indefinitely rather than for the stated two
years. Adding one is a general retention concern across every audit entry
Tendnote writes, not a household one, and it needs its own decision about
storage, scope, and who may still read an entry as it ages.
