# Hosted telemetry provider evidence

Checked against primary sources on 2026-09-17 for
[Decide the hosted telemetry provider and its data boundary](https://github.com/nick-neely/tendnote/issues/575).
This is documentation and source research, not validation of a deployed
integration. The product choice is in the
[decision artifact](../phase-9b/hosted-telemetry-and-data-boundary.md).

## GlitchTip: preferred error service

GlitchTip documents an issues interface, error-frequency alerts, and source
map support for readable JavaScript stack traces. It supports Sentry-compatible
SDKs, including Next.js and Node integrations. These capabilities serve the
owner's requirement for dedicated error investigation and triage; they are not
evidence that stock SDK payloads meet Tendnote's approved boundary.
[Error tracking](https://glitchtip.com/documentation/error-tracking/),
[SDK documentation](https://glitchtip.com/sdkdocs/).

The hosted US service runs in DigitalOcean NYC1. Its published policy says
events are purged after ninety days and daily database snapshots are retained
for seven days. The backup period is separate from active event retention,
not proof of all-copy deletion at day ninety. A public DPA template is linked
from the architecture page.
[Hosted architecture](https://glitchtip.com/documentation/hosted-architecture/).

The current Free plan includes 1,000 events/month; Small lists 100,000 at
$15/month. Error occurrences, uptime checks, performance transactions, and
release-file uploads consume the published event allowance. Exceeding quota
causes progressive throttling rather than making missing reports evidence of
an error-free service. No tier or purchase was approved in this decision.
[Pricing](https://glitchtip.com/pricing/).

### Erasure capability and limits

Research inspected the hosted [live OpenAPI schema](https://app.glitchtip.com/api/openapi.json)
and official backend commit `0299ab96b269070674f00ba43257d62b529fa1b1`, which was
repository HEAD during inspection. Source behavior is not proof of the hosted
deployment's exact revision or a contractual completion deadline.

- The schema advertises whole-issue deletion, including bulk issue deletion.
  Individual issue-event and project-event detail routes expose GET, with no
  advertised ingested-end-user erasure endpoint.
- Single issue deletion marks the issue deleted, queues a task, and returns
  HTTP 204. Bulk deletion also marks and queues. Acceptance or invisibility
  is not proof of completed erasure.
  [Issue API source](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/0299ab96b269070674f00ba43257d62b529fa1b1/apps/issue_events/api/issues.py#L234).
- The task removes all selected issues' database events and related rows,
  including aggregates and tags. It does not limit deletion to one end user;
  the same user's events in other issues are unaffected.
  [Task source](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/0299ab96b269070674f00ba43257d62b529fa1b1/apps/issue_events/tasks.py#L14),
  [Deletion routine](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/0299ab96b269070674f00ba43257d62b529fa1b1/apps/issue_events/maintenance.py#L44).
- Issue filters support tag queries. An explicitly captured opaque account
  tag may therefore locate affected issues, but completeness across all
  retained events needs verification. Do not assume an SDK's `user.id` field
  is indexed under the needed tag or that a default query spans all history.
  [Filtering source](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/0299ab96b269070674f00ba43257d62b529fa1b1/apps/issue_events/services.py#L133).
- The inspected issue-deletion routine has no removal/rewrite of archived
  Parquet files. The module separately describes archival and expiry-based
  cleanup. This leaves a question about hosted archive configuration and
  deletion propagation, not a verified claim that hosted GlitchTip retains
  deleted events improperly.
  [Maintenance source](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/0299ab96b269070674f00ba43257d62b529fa1b1/apps/issue_events/maintenance.py#L134).
- Deleting a GlitchTip operator user is different from erasing a Tendnote
  customer's error events. The user deletion route is for the authenticated
  operator's own account.
  [User API source](https://gitlab.com/glitchtip/glitchtip-backend/-/blob/0299ab96b269070674f00ba43257d62b529fa1b1/apps/users/api.py#L84).

The owner accepts loss of unrelated error history from whole-issue deletion.
The remaining hosted completion, exhaustive matching, archive, metadata, and
restore commitments belong to
[Qualify hosted GlitchTip's account-erasure contract](https://github.com/nick-neely/tendnote/issues/586).
No provider contact or provisioning occurred during this research.

## PostHog: retention does not fit the chosen policy

PostHog Cloud specifies one year of event retention on Free and seven years
on paid plans; the window cannot be shortened, including by request.
Enforcement is rolling out per project, and the documented retention behavior
filters queries rather than establishing a physical-erasure deadline. These
facts do not meet the chosen ninety-day expiry policy.
[Event retention](https://posthog.com/docs/data/events-retention).

PostHog supports explicit capture and controls to disable automatic behavioral
collection and replay. Person deletion requires explicit event deletion;
the deletion is asynchronous. Discarding stored IP addresses does not mean
the provider never received them. Those controls do not resolve the retention
mismatch, so no third-party product-analytics service was selected.
[JavaScript configuration](https://posthog.com/docs/libraries/js/config),
[Data storage and deletion](https://posthog.com/docs/privacy/data-storage).

## Sentry: comparison, not a selected fallback

Sentry documents thirty-day error retention for Developer and ninety days for
Team/Business. Its security page describes backup deletion ninety days after
backup creation; that is not an all-copy deletion promise ninety days after
the original error. Its erasure guidance says to delete entire issues
containing an end user's events because individual event deletion is not
supported. Thus Sentry also requires attention to collateral deletion and
backup windows. No automatic fallback to Sentry was selected.
[Error retention](https://sentry.zendesk.com/hc/en-us/articles/27118913621019-How-Long-Are-Errors-Events-Stored-in-Sentry),
[Security practices](https://sentry.io/security/),
[End-user erasure guidance](https://www.sentry.help/en/articles/16187006-how-do-i-complete-a-gdpr-erasure-request-for-a-user-in-sentry).
