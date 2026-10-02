# @tendnote/marketing

The public marketing site for `tendnote.com`, deployed as its own Vercel project. It is static, has no authentication, never reads the product session, and sets no cookies or tracking. It reuses the product's design system through `@tendnote/ui`.

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

The offer's figures and the support address live once in `src/lib/offer.ts`. The recovery sentence on Privacy & AI appears only while `LAST_PASSED_RESTORE_DRILL` in `src/lib/restore-drill.ts` is under six months old.

## Configuration

Both variables are read at build time and are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TENDNOTE_APP_ORIGIN` | `https://app.tendnote.com` | Origin that Sign in and Subscribe link to. Must be a bare origin, such as a preview app deployment |
| `TENDNOTE_STATUS_PAGE_URL` | unset | The independently hosted status page. The footer omits Status until it is set |
