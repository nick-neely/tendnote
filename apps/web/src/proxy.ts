import { checkAccess } from "@tendnote/db/queries/access-profiles";
import { type NextRequest, NextResponse } from "next/server";
import { localFallbackOwnerUserId } from "@/lib/access/access-state";
import {
  applyEveOwnerHeaders,
  decideEveIngress,
  enforceEveIngressBudget,
} from "@/lib/access/eve-ingress";
import { getAuth } from "@/lib/auth/server";
import { getProductRateLimiter } from "@/lib/rate-limit";

/**
 * Runs in the Node.js runtime (not Edge) so it can read the Better Auth session
 * and the access profile, which use Postgres + Redis. Only the same-origin Eve
 * endpoints need it.
 */
export const config = {
  matcher: ["/eve/v1/:path*"],
};

/**
 * The single trust boundary for the same-origin Eve mount. The browser streams
 * turns directly to `/eve/v1/*` (withEve), so this validates the Better Auth
 * session, requires admitted Private Beta Access, and injects the resolved owner
 * as a server-set header before withEve rewrites the request to the agent. It
 * strips any client-supplied owner first, so the browser cannot forge it, and
 * denies pending or unauthenticated callers in hosted environments. The agent
 * keeps its simple header-trust channel auth because this header is now always
 * server-set.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let user: { id: string } | null = null;

  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    user = session?.user ? { id: session.user.id } : null;
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
  }

  const decision = await decideEveIngress(
    user,
    // Admit on persisted access, not the full Vercel Flags resolver: the flag's
    // request-scoped `identify` can't run in middleware. Eve is only reachable
    // from the app shell, whose page load runs the resolver and persists any
    // flag grant first, so a granted user is already persisted by the time they
    // stream a turn.
    async (userId) => (await checkAccess({ userId })).admitted,
    {
      localFallbackOwnerUserId: localFallbackOwnerUserId({
        nodeEnv: process.env.NODE_ENV,
        devOwnerUserId: process.env.TENDNOTE_DEV_OWNER_USER_ID,
      }),
    },
  );

  const headers = applyEveOwnerHeaders(request.headers, decision);

  if (!headers) {
    // A signed-in pending user is authenticated but not yet admitted (403); an
    // unauthenticated caller needs to sign in (401).
    const pending = decision.type === "denied" && decision.reason === "pending";

    return NextResponse.json(
      {
        error: pending
          ? "Private Beta Access is required to use the assistant."
          : "Sign in to use the assistant.",
      },
      { status: pending ? 403 : 401 },
    );
  }

  // Admitted: charge the product rate limiter before forwarding the turn to the
  // agent, so abusive or accidental chat usage can't consume unbounded runtime.
  if (decision.type === "owner") {
    const budget = await enforceEveIngressBudget(getProductRateLimiter(), decision.ownerUserId);

    if (budget.type === "limited") {
      return NextResponse.json(
        { error: "You're sending messages too quickly. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(budget.retryAfterSeconds) } },
      );
    }
  }

  return NextResponse.next({ request: { headers } });
}
