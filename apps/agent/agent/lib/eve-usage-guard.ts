import { EVE_USAGE_PAUSED_CODE, type UsageNotice } from "@tendnote/domain/usage-bounds";
import type { AuthFn } from "eve/channels/auth";

/** Eve's create route and its one-session message route (`/eve/v1/session/:sessionId`). */
const NEW_MESSAGE_ROUTE = /^\/eve\/v1\/session(?:\/[^/]+)?$/;

/**
 * Whether the request starts a turn: a new conversation, or a message to an
 * existing one. An answer to a parked approval (`inputResponses`) continues a
 * turn that already started, so it is not one; neither is any stream, cancel,
 * compact, clear, reset, or info route.
 */
async function startsTurn(request: Request): Promise<boolean> {
  if (request.method !== "POST" || !NEW_MESSAGE_ROUTE.test(new URL(request.url).pathname)) {
    return false;
  }
  try {
    const body = (await request.clone().json()) as { inputResponses?: unknown } | null;
    return body?.inputResponses === undefined;
  } catch {
    // Eve refuses a body it cannot parse before any turn starts.
    return false;
  }
}

/**
 * Thrown to refuse a new turn. Eve's route auth returns any thrown value
 * carrying a `Response` verbatim; a 403 rather than a 429, because Eve's client
 * retries a 429 and this answer will not change until the Usage Period resets.
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
        error: "Eve is paused until your usage resets.",
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
 * Interactive Eve's Account Ceiling, at the one door every turn comes through.
 * While the account's notice is paused, a new conversation or message is
 * refused with that notice; a turn already running finishes, its approvals can
 * still be answered, and every other route is untouched.
 *
 * It decides only whether a turn may start. The principal it passes on is the
 * inner policy's, unchanged, so the mode gate, approval gates, and egress rules
 * see exactly what they would without a limit (ADR 0246). Records, reminders,
 * export, billing, and cancellation never come through Eve and are not touched.
 */
export function createUsagePauseGuard(deps: UsagePauseGuardDependencies): AuthFn<Request> {
  return async (request) => {
    const principal = await deps.auth(request);
    if (!principal || !(await startsTurn(request))) return principal;

    const notice = await deps.readUsageNotice(principal.principalId);
    if (notice.state === "paused") throw new EveUsagePausedError(notice);
    return principal;
  };
}
