# Status page

`notice.json` is the one Service Notice source. The static status page is built
from it and published to a host independent of the product's Vercel project
and database, and the product fetches the published copy for its in-app banner
(`TENDNOTE_STATUS_PAGE_URL`).

To post or update a notice, edit `notice.json` and push to `main`:

```json
{
  "notice": {
    "message": "Reminders are delivering late. We are working on it.",
    "updatedAt": "2026-10-01T15:00:00Z"
  }
}
```

To clear it, set `"notice": null`. Notices are content-free and never name a
customer. While an incident notice is open, update it at least once a day.
Preview locally with `node scripts/build-status-page.mjs <out-dir>`.
