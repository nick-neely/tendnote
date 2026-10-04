# Runbook: revoke every session

Last in the [rotation order](../README.md#credential-rotation), after every
credential is rotated, so no session opened with an exposed credential
survives. It deletes every session row in the database and every Better Auth
key in Redis, then confirms by query that both counts are zero. Everyone is
signed out.

## Trigger

An [incident](../incident.md), once its credential rotations are done. Always
run it when any credential was rotated, even if Vercel's `BETTER_AUTH_SECRET`
rotation already made existing cookies invalid.

## Preconditions

1. The Incident Record is open, and every in-scope credential is rotated.
2. Production's environment, with the rotated values, is freshly pulled
   ([operations README](../README.md)). The step acts on the `DATABASE_URL` and
   `REDIS_URL` in it.

## Steps

1. Run:

   ```sh
   pnpm --filter @tendnote/web restore invalidate-sessions
   ```

   It first prints the database it acts on. Check that it is production's. It
   then prints `ok`, the counts `deleted`, and the counts `remaining`.
2. If `ok` is `false`, run it again. Run it while the
   [Service-Wide Hold](../service-wide-hold.md) is in force, if one is, so no
   one can sign in meanwhile. Without a hold, someone who signs in between the
   delete and the count leaves `remaining` above zero. That is a new session
   made with the rotated credentials, not a failure.

## Record produced

The Incident Record gets the time of the run and its printed report, which
holds counts only. No other record changes.

## Verification

1. Under a hold, the report's `remaining` counts are both `0`.
2. A browser that was signed in before the run is signed out on its next
   request.

## Rollback

None, and none needed: a revoked session cannot return, and each person simply
signs in again.
