import { type AdmissionEnvironment, parseAdmissionPolicy } from "@tendnote/domain/admission";
import { renderServiceHoldPage } from "./service-wide-hold-page";

/**
 * The one route a Service-Wide Hold leaves answering (#634): Stripe's webhook
 * receiver, so billing events keep being recorded for reconciliation. The
 * status page is hosted apart from the product and never reaches this proxy.
 */
const HELD_EXEMPT_PATH = "/api/stripe/webhook";

/** How long one instance trusts its last read before asking the database again. */
export const SERVICE_HOLD_REREAD_MS = 5_000;

/** A read slower than this keeps the last answer, so a slow database never stalls every request. */
const READ_TIMEOUT_MS = 1_500;

/** When a held client should try again. */
const RETRY_AFTER_SECONDS = 300;

type HoldReader = () => Promise<boolean>;

/**
 * Whether a Service-Wide Hold is in force, read at most once per interval per
 * instance with concurrent requests sharing one read. A failed or slow read
 * keeps the last answer: the hold is placed deliberately and read again within
 * seconds, and a database too broken to answer cannot serve the product anyway.
 */
export function createServiceHoldCheck(input: {
  read: HoldReader;
  now?: () => number;
  logger?: Pick<Console, "error">;
}): () => Promise<boolean> {
  const now = input.now ?? Date.now;
  let held = false;
  let readAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<boolean> | null = null;

  return () => {
    if (now() - readAt < SERVICE_HOLD_REREAD_MS) return Promise.resolve(held);
    inFlight ??= withTimeout(input.read(), READ_TIMEOUT_MS)
      .then(
        (value) => {
          held = value;
        },
        (error: unknown) => {
          input.logger?.error("service_wide_hold.read_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        },
      )
      .then(() => {
        readAt = now();
        inFlight = null;
        return held;
      });
    return inFlight;
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer within ${ms}ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The Service-Wide Hold at the proxy (#634): while a hold is in force, every
 * request but the Stripe webhook is refused with a 503, so pages, Server
 * Functions, Better Auth, Eve, export, deletion, cron, and queue callbacks all
 * stop at the door. A navigation gets a static page pointing at the status
 * page; nothing behind it is rendered or read. Hosted only: a self-hosted
 * deployment has no operator hold. Returns the refusal, or `null` to continue.
 */
export async function serviceHoldResponse(
  request: { method: string; url: string },
  isHeld: () => Promise<boolean>,
  env: AdmissionEnvironment = process.env,
): Promise<Response | null> {
  if (parseAdmissionPolicy(env).mode !== "hosted") return null;
  if (new URL(request.url).pathname === HELD_EXEMPT_PATH) return null;
  if (!(await isHeld())) return null;

  const statusPageUrl = env.TENDNOTE_STATUS_PAGE_URL?.trim() || null;
  const headers = { "cache-control": "no-store", "retry-after": String(RETRY_AFTER_SECONDS) };
  if (request.method === "GET" || request.method === "HEAD") {
    return new Response(request.method === "HEAD" ? null : renderServiceHoldPage(statusPageUrl), {
      status: 503,
      headers: { ...headers, "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response(
    `Tendnote is temporarily offline.${statusPageUrl ? ` Status: ${statusPageUrl}` : ""}`,
    { status: 503, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } },
  );
}
