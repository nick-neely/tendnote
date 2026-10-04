# Runbook: rotate the other credentials

After the six providers in the [rotation order](../README.md#credential-rotation)
and before Sessions. These credentials sit outside those providers, but each is
in the projects' environment, so an exposed environment exposes them too.

| Variable | Project | Rotated in | Sheet entry |
| --- | --- | --- | --- |
| `GITHUB_CLIENT_SECRET` | web | The GitHub OAuth app: generate a new client secret, then delete the old one | **OAuth apps** |
| `GOOGLE_CLIENT_SECRET` | web, Eve | The Google Cloud OAuth client: add a secret, then disable and delete the old one | **OAuth apps** |
| `DISCORD_CLIENT_SECRET` | web | The Discord application's **OAuth2** page: reset the secret | **OAuth apps** |
| `DISCORD_BOT_TOKEN` | Eve | The Discord application's **Bot** page: reset the token | **OAuth apps** |
| `REDIS_URL` | web, Eve | The Redis service: reset the password or rotate the access key | **Redis** |
| `TENDNOTE_OPERATOR_ALERT_PUSH_URL`, `TENDNOTE_OPERATOR_ALERT_PUSH_TOKEN` | web | ntfy: move to a new unguessable topic and a new access token, then delete the old token | **Alert channel** |
| `WEB_PUSH_VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` | web | Generate a new pair: `pnpm --filter @tendnote/web exec web-push generate-vapid-keys --json` | **Vercel** |
| `TENDNOTE_SYNTHETIC_CHECK_PASSWORD` | web | Change the synthetic account's password in the app | **Synthetic check** |

## Trigger

An [incident](../incident.md) whose scope includes any credential in the table,
or the projects' environment, or whose scope is unknown.

## Preconditions

1. The Incident Record is open, and the six providers are already rotated.
2. **Rotating the Web Push pair has a cost.** Every installed app must turn
   reminders on again, because existing subscriptions are bound to the old
   public key. Rotate it only if the private key may be exposed.

## Steps

1. For each credential in the table that is in scope, create the new value
   where the table says, before the old one is revoked where the provider
   allows both at once.
2. Set each new value in Production on the projects the table names, and
   redeploy them.
3. Revoke or delete each old value at its provider.
4. Review each provider's own audit or activity log for the incident window,
   where it has one, and export the findings into the incident log.

## Record produced

The Incident Record gets the time each credential was rotated and any misuse
found. It never gets a value.

## Verification

1. GitHub sign-in completes. Google linking and Discord linking each complete
   for a test account. A Discord slash command gets an answer.
2. Signing in works, which reads the session from Redis.
3. A test alert reaches the new ntfy topic. The next cron pass logs no alert
   send failure.
4. After a Web Push rotation, turning reminders on again and receiving a
   reminder push works.

## Rollback

None: an exposed credential must not return. A value set wrong is fixed by
setting the right value and redeploying.
