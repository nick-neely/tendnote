import type { DiagnosticEnvelope } from "./envelope";

/*
 * GlitchTip speaks Sentry's ingestion protocol. Tendnote does not install a
 * Sentry SDK (ADR 0257): an SDK's automatic integrations add request, user,
 * breadcrumb, and device fields on their own, and proving each one off is
 * harder than never having them. The outbound event is built here, by hand,
 * from the validated envelope alone, and sent with no header but its own.
 */

/** Where reports go: the store endpoint and the project's public key, from the DSN. */
export type GlitchTipTarget = { storeUrl: string; publicKey: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Read a DSN (`https://<key>@<host>/<project>`). Anything else, including no
 * DSN at all, is `null`: reporting stays off until the payload-proof gate
 * (#655) provisions one. Plain HTTP is accepted only for a local capture
 * server, so a report never crosses the network unencrypted.
 */
export function glitchTipTarget(dsn: string | undefined): GlitchTipTarget | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const project = url.pathname.replace(/^\/+|\/+$/g, "");
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!secure || !url.username || !/^\d+$/.test(project)) return null;
  return {
    storeUrl: `${url.origin}/api/${project}/store/`,
    publicKey: decodeURIComponent(url.username),
  };
}

/** The deployment's release: the short commit, never anything about the request. */
export function diagnosticRelease(commitSha: string | undefined): string {
  return commitSha && /^[0-9a-f]{7,40}$/.test(commitSha) ? commitSha.slice(0, 12) : "unreleased";
}

/**
 * The whole outbound event. Its fields are the envelope's, renamed to the
 * protocol's: the code is the exception type, the operation is the
 * transaction, the stack is frames (outermost first, as the protocol orders
 * them), and the runtime is one context. There is no message, `user`,
 * `request`, `breadcrumbs`, `extra`, `tags`, or `server_name`.
 */
export function glitchTipEvent(envelope: DiagnosticEnvelope, release: string) {
  const frames = [...envelope.frames].reverse().map((frame) => ({
    filename: frame.file,
    function: frame.function,
    lineno: frame.line,
    colno: frame.column,
    // Tendnote's own code is what its build emits; a dependency, a built-in, or
    // an unknown file is not.
    in_app: frame.file.startsWith("/_next/") || frame.file.startsWith(".next/"),
  }));
  const runtime = {
    name: envelope.runtime.name,
    ...(envelope.runtime.major === null ? {} : { version: String(envelope.runtime.major) }),
  };
  return {
    platform: envelope.platform,
    level: "error" as const,
    release,
    transaction: envelope.operation,
    exception: {
      values: [
        {
          type: envelope.code,
          ...(frames.length === 0 ? {} : { stacktrace: { frames } }),
        },
      ],
    },
    contexts: envelope.platform === "node" ? { runtime } : { browser: runtime },
  };
}

export type GlitchTipEvent = ReturnType<typeof glitchTipEvent>;

const SEND_TIMEOUT_MS = 2_000;

/** POST one event. The only headers are the content type and the project's auth. */
export async function sendToGlitchTip(
  target: GlitchTipTarget,
  event: GlitchTipEvent,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(target.storeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_client=tendnote-diagnostics/1, sentry_key=${target.publicKey}`,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GlitchTip refused a report with ${response.status}`);
}
