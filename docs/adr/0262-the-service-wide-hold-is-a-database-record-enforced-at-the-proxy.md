# ADR 0262: The Service-Wide Hold is a database record enforced at the proxy

Status: Accepted in the October 4, 2026 implementation of issue #634.

## Context

The [incident runbook](../phase-9b/hosted-runbooks-and-tabletop.md#containment)
needs one audited switch that takes the hosted product offline when an
incident's scope is unknown. It must leave the status page and the Stripe
webhook receiver answering, suspend export and deletion, and be lifted by an
audited transition. The status page is already hosted apart from the product.
The switch therefore has to stop everything the product's Vercel deployment
serves except one route. It must take effect without a deploy, because a deploy
during an incident is slow and itself a change.

There are three places a flag like this could live. An environment variable
needs a redeploy to change and leaves no record of its own. Edge Config would
add a provider and a credential to the incident path. A database row reuses the
store every audited Operator Action already writes to, and the restore's
Outbound Pause (ADR 0250) already works this way.

## Decision

**The hold is a row in `service_wide_holds`.** Placing the hold inserts a row
with the operator's reason and time. Lifting it stamps `lifted_at`. A partial
unique index allows one open hold. The rows are the audit. The operator runs
one CLI, `service-hold place|lift`, separate from the per-account Operator
Action CLI because the hold names no account.

**The proxy enforces it on hosted deployments.** While a hold is open, every
request except `/api/stripe/webhook` gets a `503` with `Retry-After`. A page
visit gets a static page, rendered by the proxy, that links to the status page.
Nothing behind the proxy runs, so pages, Server Functions, auth, Eve, export,
deletion, cron, and queue callbacks all stop at once. Each instance re-reads the
row at most every five seconds and shares one read across concurrent requests.
A failed read, or one slower than 1.5 seconds, keeps the last answer. A
database too broken to answer cannot serve the product anyway, and a slow read
must not stall every request.

**Background work checks it too.** The recovery cron and the shared queue
callback read the hold beside the Outbound Pause. This covers queue deliveries
that may not pass through the proxy and any deployment where the proxy is not
in front. A held cron pass does nothing, and a held queue message is
redelivered later.

**Deletion's stuck alert counts from the lift.** An intent that waited through
a hold is not stuck until twenty-four hours after the latest lift, as the
[deletion-tail decision](../phase-9b/backup-window-and-deletion-tail.md)
requires.

## Consequences

- Placing or lifting the hold takes effect within about five seconds on every
  instance, with no deploy.
- Each instance makes at most one indexed read every five seconds, outside
  the request path except on the read that refreshes the cached answer.
- A new instance starts out treating the service as not held until its first
  read answers. If the database cannot answer at all, that instance serves
  requests that fail at the database anyway. The cron and the queue
  consumers still read the hold themselves.
- The hold is not journaled. It names no account, and the restore does not
  reconcile admission against it. A restore to a point before the hold brings
  back a database without the row, so the runbook places the hold again on
  the restored branch when it must outlast the restore.
- Self-hosted deployments never read the hold at the proxy.
