import {
  type BrowserDiagnostic,
  type BrowserOperation,
  coarseBrowser,
  diagnosticErrorCode,
  sanitizeStack,
} from "./envelope";

const DIAGNOSTICS_PATH = "/api/diagnostics";

/** A page that keeps failing is one problem, not a stream of reports. */
const MAX_REPORTS_PER_PAGE = 5;

const reported = new WeakSet<Error>();
let sent = 0;

/**
 * Sanitize a browser error into the diagnostic envelope and hand it to
 * Tendnote, which decides whether it may be collected and forwards it. The
 * message, the page URL, and the user-agent string never leave this function;
 * only the error's kind, its sanitized stack, and the browser's family and
 * major version do.
 *
 * Fire and forget: it never throws, never waits, and never retries.
 */
export function reportBrowserError(error: unknown, operation: BrowserOperation): void {
  try {
    // A thrown string or a cross-origin "Script error." has no stack to locate.
    if (!(error instanceof Error) || reported.has(error)) return;
    reported.add(error);
    // A Server Components error reaches the browser as a placeholder with a
    // digest; the server already reported the real one.
    if (typeof (error as { digest?: unknown }).digest === "string") return;
    if (sent >= MAX_REPORTS_PER_PAGE) return;
    sent += 1;

    const report: BrowserDiagnostic = {
      code: diagnosticErrorCode(error),
      operation,
      frames: sanitizeStack(error),
      browser: coarseBrowser(navigator.userAgent),
    };
    fetch(DIAGNOSTICS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never become the error.
  }
}
