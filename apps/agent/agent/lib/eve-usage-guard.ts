import { EVE_USAGE_PAUSED_CODE, type UsageNotice } from "@tendnote/domain/usage-bounds";
import type { AuthFn } from "eve/channels/auth";

/** Eve's create route and its one-session message route (`/eve/v1/session/:sessionId`). */
const NEW_MESSAGE_ROUTE = /^\/eve\/v1\/session(?:\/[^/]+)?$/;

/**
 * Whether the request can put the model to work: a new conversation, a message,
 * or an answer to a parked request. Answers count too, because Eve runs an
 * answer that matches no pending request as new input, and nothing at this door
 * can tell a genuine answer from an unmatched one. Streams, cancels, compact,
 * clear, reset, and info never start one.
 */
function startsModelWork(request: Request): boolean {
  return request.method === "POST" && NEW_MESSAGE_ROUTE.test(new URL(request.url).pathname);
}

/**
 * Thrown to refuse a new turn. Eve's route auth returns any thrown value
 * carrying a `Response` verbatim; a 403 rather than a 429, because Eve's client
 * retries a 429 and this answer will not change until the Usage Period resets or
 * service is restored.
 */
class EveUsagePausedError extends Error {
  readonly response: Response;

  constructor(notice: UsageNotice) {
    super("Eve is paused.");
    this.name = "EveUsagePausedError";
    this.response = Response.json(
      {
        ok: false,
        code: EVE_USAGE_PAUSED_CODE,
        error: "Eve is paused.",
        notice,
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
}

export type UsagePauseGuardDependencies = {
  /** The route-auth policy that proves who is calling and that they may. */
  auth: AuthFn<Request>;
  /** Interactive Eve's usage notice for an account. */
  readUsageNotice: (userId: string) => Promise<UsageNotice>;
};

/**
 * Interactive Eve's Account Ceiling and the Spend Breaker's last stage, at the
 * one door every turn comes through. While the account's notice is paused, a
 * new conversation, message, or answer is refused with that notice. A turn
 * already streaming finishes; one parked on an approval stays parked until the
 * pause lifts, since resuming it spends model calls too. Every other route is
 * untouched.
 *
 * It decides only whether a turn may start. The principal it passes on is the
 * inner policy's, unchanged, so the mode gate, approval gates, and egress rules
 * see exactly what they would without a limit (ADR 0246). Records, reminders,
 * export, billing, and cancellation never come through Eve and are not touched.
 */
export function createUsagePauseGuard(deps: UsagePauseGuardDependencies): AuthFn<Request> {
  return async (request) => {
    const principal = await deps.auth(request);
    if (!principal || !startsModelWork(request)) return principal;

    const notice = await deps.readUsageNotice(principal.principalId);
    if (notice.state === "paused") throw new EveUsagePausedError(notice);
    return principal;
  };
}
