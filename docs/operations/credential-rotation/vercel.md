# Runbook: rotate Vercel credentials

First in the [rotation order](../README.md#credential-rotation). Vercel holds
the deployments and every environment variable, so it is closed first, before
any new secret is stored in it. This runbook covers access to the Vercel
account and the secrets Tendnote generates itself, which live only in the
projects' environment. The other providers' keys are rotated by their own
runbooks.

Each project is listed under **Vercel** in the operations sheet: the web
project, and the Eve project where Eve deploys as its own project. A variable
that both use must hold the same value in both.

## Trigger

An [incident](../incident.md) whose scope includes the Vercel account, a
deployment, a preview, or any value in the projects' environment, or whose
scope is unknown.

## Preconditions

1. The Incident Record is open.
2. The operator can sign in to Vercel with two-factor authentication.
3. Rotating `BETTER_AUTH_SECRET` signs everyone out. It also makes the stored
   Google and Discord tokens unreadable, because they are encrypted with it,
   so every owner must reconnect those integrations. Rotate it whenever it may
   be exposed. The leaked value decrypts those tokens.

## Steps

1. **Close account access.** In Vercel account settings, change the password,
   then review sign-in sessions and log out every other session. Under
   **Tokens**, list them with `vercel tokens ls` and remove every token with
   `vercel tokens rm <token id>`, then create only the ones still needed. In
   the team's **Members**, remove anyone who should not be there. Review the
   team's audit log for the incident window and export it into the incident
   log.
2. **Generate new secrets**, one per variable, with `openssl rand -base64 32`:
   `BETTER_AUTH_SECRET`, `BACKGROUND_JOB_QUEUE_SECRET` (if set),
   `CRON_SECRET`, and `FLAGS_SECRET`.
3. **Store them.** For each variable, in Production on each project that uses
   it, replace the value: `BETTER_AUTH_SECRET` and
   `BACKGROUND_JOB_QUEUE_SECRET` on the web and Eve projects, and `CRON_SECRET`
   and `FLAGS_SECRET` on the web project. Remove the same variables from
   Preview, then set new Preview values different from Production's.
4. **Close the Blob store token.** The store is under **Vercel Blob**. Vercel
   documents no way to rotate or revoke a store's long-lived
   `BLOB_READ_WRITE_TOKEN`. Its documented answer is OIDC, whose short-lived
   tokens rotate on their own. If a project still sets the static token and
   it may be exposed, ask Vercel support to revoke it, and record in the
   Incident Record that it stays valid until they do. Moving the store to
   OIDC, so production holds no static token, is
   [#741](https://github.com/nick-neely/tendnote/issues/741).
5. **Redeploy Production** on every project, the web project last, so that
   both sides of the queue and reconciliation signatures change together.
   Queue messages signed with the old secret are refused. The recovery cron
   republishes their work on its next passes.
6. **Delete stale previews.** Delete every preview deployment built with an
   exposed value, so none keeps serving it.

## Record produced

The Incident Record gets the time of each step, the token ids removed, and the
names of the rotated variables. It never gets their values. Vercel's audit log
records each change.

## Verification

1. The app loads on Production, and signing in works. Every earlier session is
   gone.
2. The next cron pass (`/api/cron/background-jobs`) completes in the Vercel
   logs. A request with the old `CRON_SECRET` gets `401`.
3. A queue job completes, such as the extraction after a new capture.
4. An Eve turn in the web chat completes.
5. `vercel tokens ls` lists only the tokens created in step 1.

## Rollback

None for the secrets: the old values are exposed and must not return. If a new
value was set wrong, set the right value and redeploy. Owners reconnect Google
and Discord from the account page.
