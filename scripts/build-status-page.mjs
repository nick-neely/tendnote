import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_MESSAGE_LENGTH = 500;
const NOTICE_SOURCE = new URL("../status/notice.json", import.meta.url);

/**
 * Validate the Service Notice source. The file is operator-edited, so a
 * malformed notice fails the publish loudly instead of shipping a broken page.
 *
 * @param {unknown} source
 * @returns {{ message: string; updatedAt: string } | null}
 */
export function parseNoticeSource(source) {
  if (typeof source !== "object" || source === null || !("notice" in source)) {
    throw new Error('notice.json must be an object with a "notice" key.');
  }
  const { notice } = /** @type {{ notice: unknown }} */ (source);
  if (notice === null) return null;
  if (typeof notice !== "object") {
    throw new Error('"notice" must be null or an object.');
  }
  const { message, updatedAt } = /** @type {Record<string, unknown>} */ (notice);
  if (typeof message !== "string" || !message.trim()) {
    throw new Error('"notice.message" must be non-empty text.');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`"notice.message" must be at most ${MAX_MESSAGE_LENGTH} characters.`);
  }
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) {
    throw new Error('"notice.updatedAt" must be an ISO 8601 timestamp.');
  }
  return { message: message.trim(), updatedAt: new Date(updatedAt).toISOString() };
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Render the static status page. It needs no script to read, so it stays
 * legible on any browser during the outage it describes.
 *
 * @param {{ message: string; updatedAt: string } | null} notice
 */
export function renderStatusPage(notice) {
  const body = notice
    ? `<h1>Service notice</h1>
    <p>${escapeHtml(notice.message)}</p>
    <p class="meta">Updated <time datetime="${notice.updatedAt}">${notice.updatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time></p>`
    : `<h1>No current notices</h1>
    <p>There are no known problems with Tendnote right now.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tendnote status</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; color: #1c1917; background: #fafaf9; }
      @media (prefers-color-scheme: dark) { body { color: #e7e5e4; background: #1c1917; } }
      h1 { font-size: 1.5rem; }
      .meta { color: #78716c; font-size: 0.875rem; }
    </style>
  </head>
  <body>
    <p class="meta">Tendnote status</p>
    ${body}
    <p class="meta">This page is hosted separately from Tendnote so it stays readable when the service is not.</p>
  </body>
</html>
`;
}

/**
 * Build the publishable status site: the rendered page plus the validated
 * notice, which the product fetches for its in-app banner.
 *
 * @param {string} outDir
 * @param {unknown} source
 */
export function buildStatusPage(outDir, source) {
  const notice = parseNoticeSource(source);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.html"), renderStatusPage(notice));
  writeFileSync(join(outDir, "notice.json"), `${JSON.stringify({ notice }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("Usage: node scripts/build-status-page.mjs <out-dir>");
    process.exit(1);
  }
  buildStatusPage(outDir, JSON.parse(readFileSync(NOTICE_SOURCE, "utf8")));
}
