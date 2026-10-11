# Runbook: provision the synthetic First Value check

The synthetic First Value check ([ADR 0263](../adr/0263-reliability-indicators-are-read-by-the-recovery-cron-and-eve-is-asked-daily.md))
signs in as a dedicated, operator-owned synthetic account on every recovery
cron pass, and once a day asks Eve a question that only that account's fixture
Memory answers. The account is never a customer's. Its email and password live
under **Synthetic check** in the operations sheet. This runbook never copies
from the sheet.

## Trigger

Launch preparation, or a `first_value_path` or `grounded_eve_answer` alert
whose logged step is `sign_in`, `admission`, or `grounded_answer` after the
account or its fixture changed.

## Preconditions

1. The deployment is hosted and the operator alert channel is on
   (`TENDNOTE_OPERATOR_ALERT_EMAIL` or `TENDNOTE_OPERATOR_ALERT_PUSH_URL`).
2. The synthetic account's mailbox is one the operator reads, so its
   verification email arrives.

## Steps

1. Sign up on the app with the synthetic account's email and a generated
   password, accepting the Terms and Privacy Policy as the operator. Verify the
   email.
2. Admit it with the operator exemption. Against production's database:

   ```sql
   update access_profiles
   set status = 'granted', source = 'manual_grant', granted_at = now(), updated_at = now()
   where user_id = (select id from "user" where email = '<synthetic account email>');
   ```

3. Signed in as the account, skip the first-run prompt and add the fixture
   through the product, exactly as written in `FIRST_VALUE_FIXTURE`
   (`apps/web/src/lib/first-value-check.ts`): a person named **Marlow Finch**
   with the confirmed Memory **Marlow's favourite tea is lapsang souchong.**
4. Set `TENDNOTE_SYNTHETIC_CHECK_EMAIL` and `TENDNOTE_SYNTHETIC_CHECK_PASSWORD`
   on the production environment and redeploy.

## Record produced

The synthetic account, its `manual_grant` Access Profile, and its fixture. Each
pass then records a session that it signs out of, and one capped model call in
the account's Usage Ledger, or up to three when the gateway fails and the step
retries. Each daily answer adds a retired Eve session.

## Verification

With the production environment loaded:

```sh
pnpm --filter @tendnote/web first-value-check --grounded
```

It prints `"failed": []` and `"groundedAnswer": true` and exits 0. Exit 1
names the failing steps; the server log has `first_value_check.failed` with the
same step. `--grounded` runs one real Eve turn, so run it once, not in a loop.

The model step also logs `first_value_check.passed` when it passes. Both lines
carry `elapsedMs` for the step and one entry per call in `attempts`. A failed
step's `reason` is `deadline` when an attempt's 15 seconds or the total
32-second budget ran out, during a call or while waiting to retry, and
otherwise the error class. An attempt with
`outcome: "deadline"` was cut short; one with `outcome: "failed"` keeps the
gateway's `status`, `type`, `retryable`, and `generationId`, the gateway's own
id for the call. Each attempt also names its last observed `phase`: `gateway`
(waiting for generation), `usage_ledger` (generation returned and usage is being
persisted), `complete`, or `model_call` when phase instrumentation is unavailable.
A deadline alone is not evidence of a provider outage.

### Timeout confirmation and alert policy

The first call keeps its 15-second allowance; successful production samples
have taken over 12 seconds. A timed-out generation can be confirmed with a fresh
attempt after two seconds, within a **32-second total model-step deadline**.
Fast gateway errors explicitly marked retryable retain the two-/four-second
backoff. There are **at most three calls**, each requesting at most 16 output
tokens, with SDK retries disabled. A timeout or error after generation has
returned (usage persistence or completion) is **not retried**. We do not buy
another generation to conceal a bookkeeping failure. Abandoned calls receive
abort signals; if a dependency ignores cancellation it can outlive the local
wait, but cannot trigger further retries or alter the recorded result.

A confirmation success gives a passing model reading, with the original failed
attempt retained in `first_value_check.passed.attempts`. Count passes with failed
or deadline attempts as intermittent degradation when reviewing logs; do not
count only the final `first_value_check.failed` records. All attempts failing
still raises the alert in this cron pass. Non-retryable failures and other cheap
step failures still alert without waiting for another cron sample. This adds at
most 17 seconds to the model-step budget; hard failures are still detected in
one scheduled pass (up to ten minutes until the next pass, plus its execution).
The cron's existing 300-second limit covers all work, not just this probe; other
unbounded dependencies may still prevent a completed reading.

The next completed clean cheap-path sample clears its episode. Missing, off, or
failed readings hold it. The grounded answer remains independent and daily.
Sustained failures send one alert, then one recovery; a new failed episode alerts
again. There is no cross-pass debounce that could erase alternating failures.

First Value emails identify failed steps, model attempt durations and phases for
an episode opened by that pass. Retried deliveries or a concurrently claimed
notice do not substitute another pass's evidence: they explicitly say original
details are unavailable and provide the first sample timestamp for log lookup.
Recovery includes the episode's stored failing/passing sample times, even when
its delivery is delayed. Those times do **not** measure a continuous outage, and
neither notice claims measured customer impact. No error messages, account data,
provider payloads, or credentials enter the email.

After an authorized deployment, verify passively through normal cron logs:
compare the latency distribution and phase on deadline attempts; count recovered
retries as well as terminal failures; confirm sign-outs stay successful; and
check alert/recovery timestamps and delivery failures. A failed push destination
with successful email is a separate delivery problem, not a model-step failure.
Do not run extra paid probes merely to reproduce a rare timeout.

A pass that could not sign out logs `first_value_check.cleanup_failed` with an
HTTP status (`http_415`) or an error class (`TimeoutError`). It does not change
the pass's reading or alert. The synthetic session it left open lasts until
Better Auth's seven-day expiry, so a run of them means every ten-minute pass is
leaving one behind: find the cause before they pile up.

## Rollback

Unset the two environment variables and redeploy. Every pass then gives no
reading, so any open First Value alert holds until it is cleared by hand:

```sql
update operator_alerts set cleared_at = now(), recovered_at = now()
where condition in ('first_value_path', 'grounded_eve_answer') and cleared_at is null;
```

The synthetic account can then be deleted through its own account page.
