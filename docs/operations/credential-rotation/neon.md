# Runbook: rotate Neon credentials

Second in the [rotation order](../README.md#credential-rotation). Neon holds
the production database. Its credentials are the Postgres role passwords inside
`DATABASE_URL`, and the Neon API key the backup-surface check uses
(`NEON_API_KEY`). The project, its roles, and the key's id are under **Neon**
in the operations sheet.

## Trigger

An [incident](../incident.md) whose scope includes a connection string, the
Neon account or an API key, or the database itself, or whose scope is unknown.

## Preconditions

1. The Incident Record is open, and Vercel is already rotated.
2. The operator can sign in to the Neon Console with two-factor
   authentication.
3. If scope is unknown, the [Service-Wide Hold](../service-wide-hold.md) is in
   force. Steps 2 to 4 break every connection until the new string is
   deployed.

## Steps

1. **Close account access.** Change the Neon account password. Review the
   organization's members and remove anyone who should not be there.
2. **Reset every role that can log in.** In the Neon Console, open the
   production branch's **Roles**, and reset the password of every role that
   can log in, starting with the one in `DATABASE_URL`. Do the same on any
   other branch where those roles log in. Drop any role you do not recognize.
3. **Drop existing connections.** A reset only blocks new connections. Restart
   the production branch's compute from **Computes**, which ends the open ones.
4. **Store the new connection string.** Copy it from the **Connect** dialog,
   keeping the same pooling choice as before. Set it as `DATABASE_URL` in
   Production on the web and Eve projects, and redeploy both. Replace any
   local copy, such as `.env.local`.
5. **Rotate the API key.** Create a new project-scoped API key, set it as
   `NEON_API_KEY` on the web project, and redeploy. Then revoke the old key
   with `neon api-keys revoke <key id>`. The id is numeric. Confirm it with
   `neon api-keys list` first. Revoke any other key that may be exposed.

## Record produced

The Incident Record gets the time of each step, the roles reset, and the API
key ids revoked. It never gets a password or a key. Neon's project activity
records each change.

## Verification

1. The app loads, and signing in works.
2. The old connection string is refused:
   `psql '<old connection string>' -c 'select 1'` fails authentication.
3. `pnpm --filter @tendnote/web backup-surfaces`, with the new key in the
   environment, prints its findings and does not exit with `2`, which means
   it could not read Neon.
4. `neon api-keys list` shows no revoked key.

## Rollback

None: an exposed password or key must not return. A connection string set
wrong is fixed by setting the right one and redeploying. If the app cannot
connect after step 4, check the role and pooling in the string against the
**Connect** dialog.
