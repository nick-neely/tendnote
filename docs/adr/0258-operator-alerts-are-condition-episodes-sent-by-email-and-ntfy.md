# ADR 0258: Operator alerts are condition episodes, sent by email and ntfy

Status: Accepted in the October 3, 2026 implementation of issue #648.

## Context

The [operator alerting contract](../phase-9b/bounded-usage-and-support-contract.md#operator-visibility-and-alerting)
asks for one channel, email plus phone push, deduplicated per condition, with
a recovery notice when a condition clears, and no alert for backlog growth the
Spend Breaker causes on purpose. The conditions it names were each built to
log a record "the operator alert channel reads": `stripe_reconciliation.failed`,
`spend_breaker.shed`, and `account_deletion.intent_stuck`. A log line is an
event, not a state, so deduplicating and recovering from logs would need a log
pipeline Tendnote does not run. There is no on-call, no admin UI, and no
decided provider for the push leg or the support mailbox.

## Decision

**A condition is a state read each cron pass, and an alert is an episode.** At
the end of each recovery cron pass the channel reads every condition it can:
reconciliation failures or unmatched refunds from the pass just run, and
directly from the database whether any deletion intent is older than
twenty-four hours and the Spend Breaker's stage. A state is read directly
rather than inferred from a bounded sweep, which visits only some rows a pass.
A firing condition opens an episode in `operator_alerts`; a partial unique
index allows one open episode per condition, which is the deduplication. A
clear reading closes it. The alert is sent once per episode and the recovery
notice once when it closes. A stage that did not run gives no reading, so a
failed read holds an alert rather than sending a false recovery. Sends are
claimed before they leave and handed back if they fail, so the next pass
retries them.

**Shedding quiets by condition.** A condition may name the Spend Breaker stage
whose shedding makes it expected. While that stage sheds, a firing reading is
dropped: no new alert, and an open one stays open. The background backlog
condition names the background stage; the Reliability Indicators (#649)
supply its reading.

**Delivery is the existing email transport plus an ntfy topic.** Email goes
through the same Resend sender as every transactional message, keyed by the
episode so a retry is not a second message. Phone push is one HTTP POST to an
ntfy topic URL with an optional access token: no app of our own, no new SDK,
and the same call works against ntfy.sh or a self-hosted ntfy. Either
destination may be configured alone; with neither, the channel is off. A
notice counts as delivered when any destination accepted it, and a failing
destination is logged, so one that is down for good cannot repeat the other's
copy every pass. The text is fixed per condition and never names an account,
record, or message.

**New support email arrives as a Resend inbound event.** The support address
receives through Resend, whose signed `email.received` webhook raises one
alert per message, keyed by Resend's id. Only that id is read. Resend is
already the email provider, so this adds a webhook rather than a vendor.

## Consequences

- An alert lags its cause by up to one cron interval, ten minutes.
- ntfy is a new operator-only destination. It receives fixed alert titles and
  never customer data, so it is not a customer-data subprocessor, but its topic
  URL and token are credentials and live in the private operations sheet.
- The support mailbox must receive through Resend, or forward a copy to a
  Resend receiving address, for its alert to fire.
- An unmatched refund alerts until it is matched or leaves reconciliation's
  thirty-day window; leaving the window sends a recovery notice although
  nothing was resolved. A one-pass Stripe outage alerts and recovers.
- Escalation within one condition, such as the Spend Breaker moving from
  background to interactive shedding, does not alert again.
- The backup-surface check (#622) adds its condition the same way: an entry in
  the condition catalog and a reading from wherever it runs.
