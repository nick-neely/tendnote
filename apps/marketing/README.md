# @tendnote/marketing

The public marketing site for `tendnote.com`, deployed as its own Vercel project. It is static, has no authentication, never reads the product session, and sets no cookies or tracking. It reuses the product's design system through `@tendnote/ui`.

```bash
pnpm dev:marketing   # http://localhost:3002
```

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Home: the relationship loop, demo-first, with View pricing secondary |

Product, Demo, Pricing, Privacy & AI, About, Support, Fair Use, Terms, and Privacy Policy follow in their own changes; the header and footer already link to their decided paths.

## Configuration

Both variables are read at build time and are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TENDNOTE_APP_ORIGIN` | `https://app.tendnote.com` | Origin that Sign in and Subscribe link to. Must be a bare origin, such as a preview app deployment |
| `TENDNOTE_STATUS_PAGE_URL` | unset | The independently hosted status page. The footer omits Status until it is set |
