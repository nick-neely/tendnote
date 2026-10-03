import { type AdmissionEnvironment, parseAdmissionPolicy } from "@tendnote/domain/admission";
import { isRegionBlockedCountry } from "@tendnote/domain/region-block";

export const REGION_PAGE_PATH = "/region";

/** Vercel's request-country header: an ISO 3166-1 alpha-2 code, absent off Vercel. */
const REQUEST_COUNTRY_HEADER = "x-vercel-ip-country";

/** The country Vercel's edge says a request came from, or `null` when it does not say. */
export function requestCountry(headers: Pick<Headers, "get">): string | null {
  return headers.get(REQUEST_COUNTRY_HEADER);
}

/**
 * Routes the Region Block never covers. Everything else this app serves is
 * sign-up, sign-in, checkout entry, or an authenticated app route, so the block
 * is written as an exemption list: a new product route is covered by default.
 *
 * The exemptions are the region page itself and the server-to-server receivers,
 * whose callers (Vercel cron and queues, Eve's signed cache reconcile, Discord
 * interactions, Stripe webhooks) are not visitors and may originate anywhere.
 */
const EXEMPT_PATH_PREFIXES = [
  REGION_PAGE_PATH,
  "/api/cron",
  "/api/queue",
  "/api/internal",
  "/api/stripe",
  "/eve/v1/discord",
] as const;

function isExemptPath(pathname: string): boolean {
  return EXEMPT_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The hosted Region Block (ADR 0226): refuse EU, EEA, UK, and Swiss requests to
 * everything but the exempt routes. It runs only in hosted admission mode; a
 * self-hosted deployment never inherits a hosted business constraint. Returns
 * the refusal, or `null` when the request may continue.
 */
export function regionBlockResponse(
  request: { method: string; url: string; headers: Headers },
  env: AdmissionEnvironment = process.env,
): Response | null {
  if (parseAdmissionPolicy(env).mode !== "hosted") {
    return null;
  }

  if (!isRegionBlockedCountry(requestCountry(request.headers))) {
    return null;
  }

  const url = new URL(request.url);
  if (isExemptPath(url.pathname)) {
    return null;
  }

  // A navigation lands on the region page. A form post, Better Auth call, or
  // Server Function cannot follow a redirect meaningfully, so it gets a plain
  // refusal instead.
  if (request.method === "GET" || request.method === "HEAD") {
    return Response.redirect(new URL(REGION_PAGE_PATH, url), 307);
  }

  return new Response("Tendnote is not available in your region.", {
    status: 451,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
