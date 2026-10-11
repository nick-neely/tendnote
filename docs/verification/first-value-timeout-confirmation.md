# First Value timeout confirmation and reporting

Base: `94c52860eaadd150fcc966fc23199106f7db4c43` (current upstream and
production during investigation). Follow-up to #747; #748 and #749 were already
present. No production probe, configuration change, or cleanup was performed.

## Evidence and limits

Read-only production investigation on October 11, 2026 found four model-step
failures on October 9–11, all at the step's own deadline (15001–15002 ms), each
with one attempt. Recovery emails followed the next scheduled sample. The
retained 23-hour log sample contained 136 passes and two failures. Successful
latency: median 933 ms, p95 2185 ms, p99 11240 ms, maximum 12046 ms.

The code used a single 15-second deadline for all attempts, including backoff.
Consequently, a hung first call could never be retried. That deadline covers
`hostedModel`'s gateway generation **and** its awaited Usage Ledger write. The
old records cannot distinguish those phases. There is no evidence establishing
a provider outage, customer impact, or a false positive. The nine-minute email
gap is a sampling interval, not a measured outage duration.

The retained sample had no sign-out cleanup failure. Push delivery separately
logged `TypeError` on alert/recovery messages while email succeeded; its cause
remains unverified and is outside this change. Background embedding failures
also occurred on healthy passes and do not establish the model timeout's cause.

## Change

- Keep the 15-second per-call allowance; permit confirmation under a 32-second
  total budget, preserving the existing three-call cap and 2s/4s backoff.
- Preserve every attempt's outcome, duration and allowlisted gateway fields.
  Include a content-free generation/usage-persistence phase in diagnostics.
- Do not repeat generation once usage persistence has begun. Observer failures
  cannot break generation or metering. SDK retries remain disabled.
- Keep hard-outage detection within the same scheduled pass. Confirmed success
  avoids opening an episode; its earlier failures remain in the passing log.
  Terminal failure still opens one episode; a later clean sample recovers it.
- Include step/attempt context and explicit customer-impact uncertainty in new
  First Value alerts. Recovery text names the stored sample times and avoids
  claiming continuous downtime.
- Only attach current evidence to an episode whose insert this pass won, using
  its returned id. Retries and concurrent claimers explicitly fall back to
  original-sample log lookup. Existing timestamps are returned from the store;
  there is no schema migration or changed deduplication rule.

## Verification

Local checks on the final implementation:

- `pnpm verify`: typecheck, lint and all unit tests passed (web: 2909 tests;
  database: 2621; agent: 1853). Its default build step could not fetch Google
  Fonts because Turbo's strict environment filtering omitted this cloud
  environment's proxy/TLS settings.
- `pnpm build --env-mode=loose`: both production builds passed with those local
  environment settings passed through. No repository setting was changed.
- `pnpm format:check`, `pnpm db:check`, and `git diff --check`: passed. Formatting
  retains seven existing warnings for oversized evidence files.
- `pnpm coverage:ci`: all packages passed. After the final helper extraction,
  54 focused tests refreshed coverage for the sole changed source file; other
  files retained their full-suite coverage.
- `FALLOW_AUDIT_BASE=origin/main pnpm fallow:ci`: passed with no findings using
  that refreshed coverage.

Final PR-head CI and review evidence are recorded in the pull request.
The deterministic regressions exercise timeout then success, sustained timeout,
permanent error, fast retryable failures, total deadline during backoff, a late
abandoned result, ignored cancellation, slow successful generation, metering
failure, actual SDK/wrapper metering timeout, hostile diagnostic fields,
episode deduplication and alternation, missing readings, independent grounded
answer state, concurrent claims, and delayed/retried notice context.

No test needs a live model, payment request, production session or alert send.
Browser and Instant behavior are unchanged. Production effectiveness requires
passive observation after Nick approves merging/deployment: count recovered
retries as degradation as well as terminal failures, inspect deadline phases,
and confirm sustained failures still alert and clean samples recover.

## Verification fixture repair

The full suite exposed an existing clock-dependent operator CLI test: its
October 11 noon dunning expiry was already in the past by this investigation.
The unchanged test reproduced the failure alone. Pinning only that test's Date
clock to its existing October 3 fixture makes it deterministic; no billing
production behavior changed. The isolated 42-test file then passed.
