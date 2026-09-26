# GlitchTip erasure qualification: scope reduced

Record for [Qualify hosted GlitchTip's account-erasure contract](https://github.com/nick-neely/tendnote/issues/586).

The original plan tagged every error with an opaque Tendnote account ID. That
made every report account-linked and required a way to find and erase all of
one customer's events, including archives and restored backups. Public API
and source inspection did not establish that workflow, so the draft inquiry
asked GlitchTip six detailed questions. The inquiry was **not sent**.

The owner chose a simpler launch boundary: **send no account, user, session,
or other customer-linked identifier to GlitchTip**. Tendnote keeps its own
account-linked funnel events and erases those on account deletion. GlitchTip
still groups technical errors, but cannot look up an individual account's
error history. Previously sent, unlinked reports follow the provider's normal
retention rather than an account-specific deletion request.

This decision removes the provider erasure inquiry and the requirement to
obtain a promised deletion completion time. It does not establish that the
integration is safe merely by omitting a tag. Before enabling GlitchTip,
implementation must prove from captured outbound payloads that both browser
and server errors contain only the closed diagnostic fields in
[Hosted telemetry and data boundary](hosted-telemetry-and-data-boundary.md).
Test synthetic secrets in messages, URLs, headers, breadcrumbs, stack inputs,
and failure paths. Suppress IP addresses, user agents, raw URLs, SDK defaults,
and any value that could link a report to a customer. Honor US-only collection,
opt-out, and deletion before queued reports are forwarded. If this cannot be
proven, do not enable GlitchTip and reopen the provider or identifier decision.

The privacy copy should name GlitchTip, state the actual diagnostic fields,
and say that account deletion stops future optional capture while already-sent
unlinked reports remain until normal expiry. Its documented event retention
and separate seven-day database snapshots should be disclosed accurately.
Do not promise immediate removal of GlitchTip reports or call account-linked
Tendnote funnel events anonymous. Final copy remains subject to the existing
counsel review. This record does not change Tendnote's own backup policy,
which [has a separate decision](https://github.com/nick-neely/tendnote/issues/585).

Public starting evidence, read 2026-09-22:
[hosted architecture](https://glitchtip.com/documentation/hosted-architecture/),
[live API schema](https://app.glitchtip.com/api/openapi.json), and the pinned
[issue-deletion implementation](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/0299ab96b269070674f00ba43257d62b529fa1b1/apps/issue_events/maintenance.py).
