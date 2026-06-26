import { type NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/server";

/**
 * Runs in the Node.js runtime (not Edge) so it can read the Better Auth session,
 * which uses Postgres + Redis. Only the same-origin Eve endpoints need it.
 *
 * Next 16 has renamed this convention to `proxy.ts`, but the `proxy` file breaks
 * `next dev` on 16.2.9 ("adapterFn is not a function"), so we stay on the still
 * supported `middleware` convention. The build's deprecation warning is benign.
 */
export const config = {
  matcher: ["/eve/v1/:path*"],
  runtime: "nodejs",
};

/** Header the Eve channel reads to scope every tool to the owner (ADR 0001). */
const OWNER_HEADER = "x-tendnote-owner-id";
const localDemoOwnerUserId = "demo-user";

/**
 * The single trust boundary for the same-origin Eve mount. The browser streams
 * turns directly to `/eve/v1/*` (withEve), so this validates the Better Auth
 * session and injects the resolved owner as a server-set header before withEve
 * rewrites the request to the agent. It strips any client-supplied value first,
 * so the browser cannot forge the owner. The agent keeps its simple header-trust
 * channel auth because this header is now always server-set.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  let ownerUserId: string | null = null;

  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    ownerUserId = session?.user.id ?? null;
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
  }

  if (!ownerUserId) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    ownerUserId = process.env.TENDNOTE_DEV_OWNER_USER_ID ?? localDemoOwnerUserId;
  }

  const headers = new Headers(request.headers);
  headers.delete(OWNER_HEADER);
  headers.set(OWNER_HEADER, ownerUserId);

  return NextResponse.next({ request: { headers } });
}
