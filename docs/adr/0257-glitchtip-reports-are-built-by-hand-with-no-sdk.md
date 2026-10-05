# ADR 0257: GlitchTip reports are built by hand, with no SDK

Status: Accepted in the October 3, 2026 implementation of issue #641.

## Context

The [hosted telemetry decision](../phase-9b/hosted-telemetry-and-data-boundary.md)
allows error reports to reach GlitchTip only through one envelope: predefined
error codes, sanitized stack locations, release, operation name, and coarse
browser or runtime information. No account, user, or session identifier, raw
message, console output, request body, header, URL, IP address, user agent, or
breadcrumb. It also requires that SDK automatic integrations add no fields.

GlitchTip ingests Sentry's protocol, and the obvious route is a Sentry SDK.
Its integrations attach request, user, device, and breadcrumb data by
default, and they change between releases. Keeping them out means configuring
each one off, scrubbing in `beforeSend`, and re-proving both after every SDK
upgrade. That is a denylist around a payload Tendnote does not build.

## Decision

**Tendnote installs no error SDK.** The outbound GlitchTip event is built by
hand from a validated envelope and POSTed to the project's store endpoint with
only a content type and the project's auth header. A test asserts the event's
exact key set and that no Sentry or GlitchTip package is a dependency, so
adding one fails a test that points here.

**Browser errors are sanitized in the page and validated again on the
server.** The error boundary and the window error and rejection listeners send
the envelope to `/api/diagnostics`, which rebuilds it from its allowlisted
fields, answers 204 at once, and forwards afterwards. A browser report needs a
signed-in session and fits a per-account budget (`diagnostic-report`, ten a
minute), which bound who can make Tendnote forward anything, and how much.
Server errors arrive through Next's `onRequestError`. Next awaits that hook
before sending the error response and offers `after` no request scope there,
so the envelope is built at once and the rest is handed to Vercel's
`waitUntil`.

**A stack is trusted only where the message provably is not.** V8 stacks start
with `name: message`; exactly that header is cut before frames are read. If the
error's name or message changed after the stack was written, the header no
longer matches, so no frame is sent rather than risk reading message text as a
frame.

**Eligibility is checked at capture and again before forwarding.** Hosted mode,
a configured `GLITCHTIP_DSN`, a request Vercel places in the US, and an account
that has not opted out of telemetry or asked to be deleted. An anonymous server
request has no opt-out to honour and nothing to link. If eligibility cannot be
read, the report is dropped. With no DSN, nothing is sent; the DSN is set only
after the payload-proof gate (#655).

## Consequences

Reports are thinner than an SDK's: no breadcrumbs, no source-map upload, no
performance data, and no automatic capture beyond the three browser hooks and
`onRequestError`. Server errors from cron jobs, queues, and other requests with
no customer region are not reported, because their eligibility cannot be
established. Errors during the session or opt-out read are dropped for the same
reason, which can hide an outage of the database those reads need. Grouping
relies on the error code, operation, and stack locations.
