# Runbook: Service Notice

Post, update, or clear the one Service Notice. The same text appears on the
static status page and as the in-app banner, because both read
`status/notice.json`. The status page is served by GitHub Pages, apart from the
product's Vercel project and database, so it stays readable during the outage
it describes ([status page](../../status/README.md)).

## Trigger

- An incident, a [Service-Wide Hold](service-wide-hold.md), or a degradation
  customers can notice, such as late reminders or a paused function.
- An open notice that is a day old: update it at least once a day while an
  incident notice is open.
- The cause no longer affects customers: clear it.

## Preconditions

1. A checkout of `main`, and admin rights on the repository. `main` takes
   changes only through a pull request, and an admin may merge one without
   waiting for its checks.
2. The text is content-free: it names no customer, account, person, or record.
   It says what customers will notice and where the next update will appear.
   It is at most 500 characters.

## Steps

1. Edit `status/notice.json`. To post or update a notice, set the message and
   the current time in UTC:

   ```json
   {
     "notice": {
       "message": "Reminders are delivering late. We are working on it.",
       "updatedAt": "2026-10-01T15:00:00Z"
     }
   }
   ```

   To clear it, set `"notice": null`.
2. Check that the page builds: `node scripts/build-status-page.mjs /tmp/status`.
   A malformed notice fails here with the reason.
3. Commit the file alone on a new branch, open a pull request, and merge it
   at once with `gh pr merge --admin --squash`. A notice cannot wait for the
   full CI run. On `main`, the **Publish status page** workflow builds and
   deploys it. Watch it with `gh run watch`.

## Record produced

The commit on `main` is the record: who changed the notice, when, and what it
said. An incident notice's commit is also noted in the Incident Record.

## Verification

1. The **Publish status page** run succeeds.
2. The status page shows the new text with its updated time, or "No current
   notices" once cleared.
3. Within five minutes, a signed-in page of the app shows the same text in its
   banner, or no banner. The banner is cached, and a cached copy expires within
   five minutes. The Service-Wide Hold page shows no banner. It links to the
   status page instead.

## Rollback

Push the previous `notice.json`, from `git log -p status/notice.json`, with a
new `updatedAt`. A notice that was already read cannot be unread. Correct it in
the next update rather than deleting it silently.
