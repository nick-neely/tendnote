# Node runtime evidence

## Trigger

Temporary server startup diagnostics record the Node patch actually running the
application. CI/Volta pins and Vercel's `24.x` setting do not establish that patch.
This record is runtime evidence, not proof of compromise or remediation.

## Preconditions

The diagnostic PR must have reached the deployment being examined through the
normal approved release process. Preparing the PR does not change production.
Use the operator's existing authorized Runtime Logs access; no secret values or
configuration changes are needed.

## Steps

1. Select the exact deployment and environment under investigation in
   **Runtime Logs**, and restrict the time window to its active period.
2. Search for `runtime.node_version`. Build logs and another deployment's logs
   are not evidence for that deployment.
3. Check `web` and `eve` independently, retaining the record described below.
   Use normal authorized traffic or the existing cron schedule; do not invoke
   billing mutations merely to obtain a log. Missing records are inconclusive.

For example, a process running Node 24.22.1 emits:

```text
runtime.node_version { service: 'web', nodeVersion: 'v24.22.1' }
runtime.node_version { service: 'eve', nodeVersion: 'v24.22.1' }
```

- `web`: Next.js `instrumentation.register()` runs before a Node server instance
  handles requests. This covers its pages, actions, billing/Stripe handlers,
  background-jobs cron, and queue functions. Edge registration emits nothing.
- `eve`: `withEve` serves `/eve/v1/*` from a separate service. Its hook module emits
  when Eve loads hooks at startup, without subscribing to events or enabling
  authored telemetry. Check this service independently of `web`.

Each service emits at most once per JavaScript runtime, including repeated module
loads. Multiple cold starts/functions can produce multiple records; warm requests
do not produce fresh records. Inspect each relevant function/service's available
records; one version does not establish the version of every deployed instance.

## Record produced

Retain the deployment/commit, environment, function/service, timestamp, and
emitted version in the **Incident log** before any follow-up external action.

The fixed event has only `service` and `nodeVersion`, read from the executing Node
process. No endpoint, environment dump, request content, credentials, or user data
is added. No new outbound telemetry is configured.

## Verification

Confirm the records come from the intended deployment's runtime logs and identify
the service being checked. Compare each emitted `nodeVersion` with the patch
required for the investigation; a local test or build-time version cannot verify
production. Both services need their own evidence.

## Rollback

Once the required runtime evidence has been retained, remove the `register`
function from `apps/web/src/instrumentation.ts` (keep `onRequestError`), its
`lib/diagnostics/node-runtime-version.ts` module, the Eve
`hooks/node-runtime-version.ts` module, their focused tests, and this temporary
note and index entry in a follow-up PR. Use the normal separate release approval
for merging/deploying either PR.
