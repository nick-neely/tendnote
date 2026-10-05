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
4. **Close Blob access.** Locate each store under **Vercel Blob**. Connect
   the Web project using OIDC and `BLOB_STORE_ID`; hosted Eve shares that
   project's connection through `withEve`. If Eve is deployed as a separate
   project, connect it too. Keep Production's store separate from the shared
   Development/Preview store. Remove `BLOB_READ_WRITE_TOKEN` from every
   project environment and redeploy both services. Browser uploads must use
   the OIDC signed-URL flow (`uploadPresigned` / `handleUploadPresigned`),
   because the older `handleUpload` requires a static token.

   Review the operator-only `tendnote-recovery` project's Development OIDC
   connection to the Production store as well. It has no Git connection or
   deployments, and needs no static token. Remove an unauthorized project
   connection to close its OIDC access; revoking the old read-write token
   does not revoke OIDC project authorization.

   **Removing an environment variable does not revoke a copied credential.**
   After every connected project uses OIDC, the store's **Projects** tab
   offers **Revoke Token**. Redeploy each project with the new variables
   before using it for a planned migration. The upgrade dialog explicitly
   says the old `BLOB_READ_WRITE_TOKEN` keeps working until this later step.
   Revoke it, then verify the old token is refused without logging it.
   Never restore the old value.

   If a static-token consumer must remain, use **Settings > Rotate
   Credentials** instead, with no delayed expiration for exposed old
   credentials. Check connected project variables again afterwards, since
   rotation updates their credentials. Redeploy consumers before rotation if this is
   planned maintenance; during containment, revoke exposed access first.
   Apply revocation or rotation to both stores and to old deployment/local copies.

   These controls were verified in the Vercel dashboard on October 4, 2026.
   Rotation offers optional old-credential expiration delayed up to thirty days and
   warns that active deployments need redeployment. Vercel's
   [Private Blob GA announcement](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)
   explicitly confirms upgrading to OIDC and revoking the old credential
   from the dashboard. Do not assume enabling OIDC itself revokes a static
   token; until revocation (or rotation) and a refusal check confirm it, treat it as
   valid. If the control is unavailable or a rotated token still works,
   contact Vercel support and keep that gap open in the Incident Record.

   OIDC reduces future exposure: hosted tokens rotate automatically. Operator
   scripts pull `.env.recovery.local` from `tendnote-recovery` and re-pull on expiry under the
   [restore preconditions](../restore.md#preconditions).
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
