/**
 * The single trust boundary for the same-origin Eve mount. The browser streams
 * turns to /eve/v1/*, so the owner must be derived server-side from the trusted
 * session (or the local-dev fallback) and admitted Private Beta Access — never
 * from anything the client can set. This module holds the pure, testable core;
 * `proxy.ts` wires it to the real session and access check.
 */

import type { ProductRateLimiter } from "@/lib/rate-limit";

/** Header the Eve channel reads to scope every tool to the owner (ADR 0001). */
export const EVE_OWNER_HEADER = "x-tendnote-owner-id";

export type EveIngressDecision =
  | { type: "owner"; ownerUserId: string }
  | { type: "denied"; reason: "unauthenticated" | "pending" };

/**
 * Decide the Eve owner for a request. A signed-in user is admitted only when
 * their access profile is granted; a pending user is denied even in local dev.
 * An unauthenticated request is admitted only via an explicit local-dev fallback
 * owner (never supplied in production), otherwise denied — so hosted preview and
 * production fail closed. The denial reason lets the caller distinguish "sign in"
 * (401) from "not yet admitted" (403).
 */
export async function decideEveIngress(
  user: { id: string } | null,
  isAdmitted: (userId: string) => Promise<boolean>,
  options: { localFallbackOwnerUserId?: string } = {},
): Promise<EveIngressDecision> {
  if (user) {
    return (await isAdmitted(user.id))
      ? { type: "owner", ownerUserId: user.id }
      : { type: "denied", reason: "pending" };
  }

  return options.localFallbackOwnerUserId
    ? { type: "owner", ownerUserId: options.localFallbackOwnerUserId }
    : { type: "denied", reason: "unauthenticated" };
}

/**
 * Produce the outgoing headers for an Eve request, or `null` when the request is
 * denied. Any client-supplied owner header is always stripped first, so the
 * browser cannot forge the owner; an admitted request gets the server-resolved
 * owner set instead.
 */
export function applyEveOwnerHeaders(
  incoming: Headers,
  decision: EveIngressDecision,
): Headers | null {
  const headers = new Headers(incoming);
  // Strip any client-supplied value unconditionally before trusting our own.
  headers.delete(EVE_OWNER_HEADER);

  if (decision.type === "denied") {
    return null;
  }

  headers.set(EVE_OWNER_HEADER, decision.ownerUserId);
  return headers;
}

export type EveIngressBudgetOutcome =
  | { type: "allowed" }
  | { type: "limited"; retryAfterSeconds: number };

/**
 * Charge the product rate limiter for one Eve turn from an admitted owner (#103,
 * ADR-0070). Applied after the owner is resolved and before the turn is forwarded
 * to the agent, so abusive or accidental chat usage can't consume unbounded
 * assistant runtime. On a denial it returns the seconds until the window resets so
 * the caller can send a `Retry-After`.
 */
export async function enforceEveIngressBudget(
  limiter: ProductRateLimiter,
  ownerUserId: string,
  now: () => number = () => Date.now(),
): Promise<EveIngressBudgetOutcome> {
  const result = await limiter.check({ subject: ownerUserId, costCategory: "eve-ingress" });

  if (result.allowed) {
    return { type: "allowed" };
  }

  return {
    type: "limited",
    retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt.getTime() - now()) / 1000)),
  };
}
