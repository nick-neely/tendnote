# @tendnote/marketing

The public marketing site for `tendnote.com`, deployed as its own Vercel project. It is static, has no authentication, never reads the product session, and sets no cookies. Its only telemetry is anonymous public activity: a page view, the demo starting or finishing, or a Subscribe click is reported as one fixed event and page name to the product app's `/api/public-activity`, which adds one to a daily total for known-US requests only. It reuses the product's design system through `@tendnote/ui`.

```bash
pnpm dev:marketing   # http://localhost:3002
```

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Home: the relationship loop, demo-first, with View pricing secondary |
| `/product` | The relationship loop step by step, then the supporting capabilities |
| `/demo` | The Marketing Demo: a fictional, scripted story the visitor plays in five steps, with no network calls |
| `/pricing` | The one plan, every disclosure before Subscribe, the household note, and self-hosting |
| `/fair-use` | The monthly allowance, per-function states and recovery conditions, and the dollar-to-turn conversion |
| `/about` | Who makes and operates Tendnote |
| `/privacy-and-ai` | Data flow, sharing, AI processing, operator access, export and deletion |
| `/support` | The support address and the two-business-day promise |
| `/terms`, `/privacy` | The versioned documents in `docs/legal/`, rendered at the version `@tendnote/domain/legal-documents` names |

Old product links still held in emails and bookmarks, `/join/*`, `/sign-in`, and `/sign-up`, redirect permanently (308) to the same path and query on the app origin. No other path is redirected: an unknown path is a 404 that links to the app.

The offer's figures and the support address live once in `src/lib/offer.ts`. The recovery sentence on Privacy & AI appears only while `LAST_PASSED_RESTORE_DRILL` in `src/lib/restore-drill.ts` is under six months old.

## Configuration

Every variable is read at build time and is optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TENDNOTE_APP_ORIGIN` | `https://app.tendnote.com` | Origin that Sign in, Subscribe, the 404, and the legacy redirects point to. Must be a bare origin, such as a preview app deployment |
| `VERCEL_ENV` | set by Vercel | Public activity is reported only from a `production` build, or to an explicitly set `TENDNOTE_APP_ORIGIN`, so local and preview builds never move the production counters |
| `TENDNOTE_STATUS_PAGE_URL` | unset | The independently hosted status page. The footer omits Status until it is set |
