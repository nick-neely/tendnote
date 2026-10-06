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
the account's Usage Ledger. Each daily answer adds a retired Eve session.

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
step's `reason` is `deadline` when its 15 seconds ran out, during a call or
while waiting to retry, and otherwise the error class. An attempt with
`outcome: "deadline"` was cut short; one with `outcome: "failed"` keeps the
gateway's `status`, `type`, `retryable`, and `generationId`, the gateway's own
id for the call.

## Rollback

Unset the two environment variables and redeploy. Every pass then gives no
reading, so any open First Value alert holds until it is cleared by hand:

```sql
update operator_alerts set cleared_at = now(), recovered_at = now()
where condition in ('first_value_path', 'grounded_eve_answer') and cleared_at is null;
```

The synthetic account can then be deleted through its own account page.
