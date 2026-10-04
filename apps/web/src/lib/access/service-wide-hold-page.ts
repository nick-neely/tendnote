function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only an absolute http(s) URL becomes a link; anything else is left out. */
function linkableUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * The page every navigation gets while a Service-Wide Hold is in force (#634).
 * It is the proxy's own response, so it needs nothing the held product serves:
 * the styles are inline, there is no script, and the only fetched file is the
 * mark under `/icons`, which the proxy never refuses. It mirrors the auth
 * scaffold in the system faces the design tokens fall back to, because the
 * product's font files are not addressable from here. Content-free: the same
 * page for everyone, naming nobody and no cause.
 */
export function renderServiceHoldPage(statusPageUrl: string | null): string {
  const statusUrl = linkableUrl(statusPageUrl);
  const next = statusUrl
    ? `<a class="status" href="${escapeHtml(statusUrl)}">Check the status page<span aria-hidden="true"> &rarr;</span></a>`
    : `<p class="later">Please try again in a little while.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta name="color-scheme" content="light dark" />
    <title>Tendnote is offline</title>
    <style>
      :root {
        --background: oklch(1 0 0);
        --foreground: oklch(0.18 0.018 145);
        --muted: oklch(0.43 0.018 145);
        --primary: oklch(0.39 0.085 142);
        --border: oklch(0.88 0.006 145);
        --ring: oklch(0.56 0.095 142);
        --selection: oklch(0.39 0.085 142 / 16%);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --background: oklch(0.09 0 0);
          --foreground: oklch(0.96 0 0);
          --muted: oklch(0.72 0.006 145);
          --primary: oklch(0.66 0.105 142);
          --border: oklch(1 0 0 / 12%);
          --ring: oklch(0.66 0.105 142);
          --selection: oklch(0.66 0.105 142 / 24%);
        }
      }
      * { box-sizing: border-box; }
      ::selection { background: var(--selection); }
      html, body { margin: 0; }
      body {
        min-height: 100vh;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 3rem 1rem;
        background: var(--background);
        color: var(--foreground);
        font: 400 1rem/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      main {
        width: 100%;
        max-width: 24rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      @media (prefers-reduced-motion: no-preference) {
        main { animation: settle 600ms cubic-bezier(0.16, 1, 0.3, 1) both; }
        @keyframes settle { from { opacity: 0; transform: translateY(4px); } }
      }
      .logo {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
        font-size: 19px;
        line-height: 1;
        letter-spacing: -0.01em;
      }
      .logo img { width: 2rem; height: 2rem; object-fit: contain; }
      h1 {
        margin: 2rem 0 0.5rem;
        font: 600 1.75rem/1.2 Georgia, "Times New Roman", serif;
        text-wrap: balance;
      }
      .lede {
        margin: 0;
        color: var(--muted);
        font-size: 0.9375rem;
        text-wrap: pretty;
      }
      .next {
        width: 100%;
        margin-top: 2rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--border);
        font-size: 0.9375rem;
      }
      .later { margin: 0; color: var(--muted); }
      .status {
        color: var(--primary);
        font-weight: 600;
        text-decoration: none;
        text-underline-offset: 4px;
        border-radius: 0.25rem;
      }
      .status:hover { text-decoration: underline; }
      .status:focus-visible { outline: 3px solid var(--ring); outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <span class="logo">
        <picture>
          <source srcset="/icons/tendnote-mark-dark.png" media="(prefers-color-scheme: dark)" />
          <img src="/icons/tendnote-mark-light.png" alt="" width="256" height="256" />
        </picture>
        Tendnote
      </span>
      <h1>Tendnote is offline for now</h1>
      <p class="lede">We've taken the service offline while we look into a problem. It will come back at this same address, and there's nothing you need to do.</p>
      <div class="next">${next}</div>
    </main>
  </body>
</html>
`;
}
