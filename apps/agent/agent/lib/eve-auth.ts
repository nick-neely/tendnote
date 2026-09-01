import {
  type AdmissionResolverDependencies,
  createAdmissionResolver,
} from "@tendnote/db/queries/access-profiles";
import { type AuthFn, ForbiddenError, localDev, UnauthenticatedError } from "eve/channels/auth";

/** The verified principal an {@link AuthFn} resolves, without importing Eve's internal type name. */
type RouteAuthPrincipal = NonNullable<Awaited<ReturnType<AuthFn<Request>>>>;

/**
 * Stable framework-owned prefix shared by every session-ID-addressed Eve route
 * (`/eve/v1/session/:sessionId`, plus its `/cancel`, `/compact`, `/clear`,
 * `/reset`, and `/stream` suffixes). The create route (`/eve/v1/session`, no
 * trailing id) and the info route sit outside this prefix. Eve mounts these
 * paths absolutely, so matching the absolute prefix is exact.
 */
const EVE_SESSION_ROUTE_PREFIX = "/eve/v1/session/";

export type SessionAuthDependencies = {
  getSession: (headers: Headers) => Promise<{
    user: { id: string; email?: string | null; emailVerified?: boolean };
  } | null>;
  /** Shared Web/Eve admission resolver; checkAccess is retained for narrow callers/tests. */
  resolveAccess?: (entity: {
    userId: string;
    email?: string | null;
    emailVerified?: boolean;
  }) => Promise<{ admitted: boolean }>;
  checkAccess?: (userId: string) => Promise<{ admitted: boolean }>;
  checkIngressBudget: (userId: string) => Promise<{ allowed: boolean }>;
};

export type TendnoteAdmissionAuthDependencies = Omit<
  SessionAuthDependencies,
  "resolveAccess" | "checkAccess"
> & {
  admission: AdmissionResolverDependencies;
};

/**
 * The hosted Eve trust boundary. The Vercel service receives the browser's
 * Better Auth cookie directly, so it authenticates and authorizes that cookie
 * here instead of trusting a header from Next.js routing that never runs.
 */
export function createTendnoteSessionAuth(deps: SessionAuthDependencies): AuthFn<Request> {
  return async (request) => {
    let session: Awaited<ReturnType<SessionAuthDependencies["getSession"]>>;
    try {
      session = await deps.getSession(request.headers);
    } catch {
      throw new UnauthenticatedError({
        code: "session_verification_failed",
        message: "Your session could not be verified. Please sign in again.",
      });
    }

    if (!session) return null;

    const userId = session.user.id;
    const access = deps.resolveAccess
      ? await deps.resolveAccess({
          userId,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
        })
      : deps.checkAccess
        ? await deps.checkAccess(userId)
        : { admitted: false };
    if (!access.admitted) {
      throw new ForbiddenError({
        code: "private_beta_access_required",
        message: "Private Beta Access is required to use the assistant.",
      });
    }

    if (!(await deps.checkIngressBudget(userId)).allowed) {
      throw new ForbiddenError({
        code: "eve_ingress_rate_limited",
        message: "You're sending messages too quickly. Please wait a moment and try again.",
      });
    }

    return {
      // Trusted route marker used by ambient post-accept hooks. Other channels and
      // subagents must not become eligible merely because they carry a user principal.
      attributes: { channel: "eve" },
      authenticator: "better-auth",
      principalId: userId,
      principalType: "user",
    };
  };
}

/** Build Eve's session boundary over the same persisted admission resolver as Web. */
export function createTendnoteAdmissionAuth(
  deps: TendnoteAdmissionAuthDependencies,
): AuthFn<Request> {
  const admission = createAdmissionResolver(deps.admission);

  return createTendnoteSessionAuth({
    getSession: deps.getSession,
    resolveAccess: (entity) => admission.resolveAccess(entity),
    checkIngressBudget: deps.checkIngressBudget,
  });
}

type LocalOwnerEnvironment = {
  TENDNOTE_DEV_OWNER_USER_ID?: string;
  [key: string]: string | undefined;
};

/**
 * Opaque not-found raised when the authenticated caller is not the session's
 * owner (or the session has no owner binding). Eve's `routeAuth` returns any
 * thrown value carrying a `Response` verbatim, so this rejects the route with a
 * 404 that is byte-identical for "someone else's session" and "no such session":
 * a caller can never tell a foreign session apart from a nonexistent one, which
 * a 403 would leak. Eve's own client treats a 404 on stream open as retryable,
 * so the owner's just-created session (whose binding lands a beat later, when
 * `session.started` fires) reconnects cleanly instead of failing.
 */
export class EveSessionNotFoundError extends Error {
  readonly response: Response;

  constructor() {
    super("Session not found.");
    this.name = "EveSessionNotFoundError";
    this.response = Response.json(
      { error: "Session not found.", ok: false },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
}

/**
 * The session id addressed by an ID-scoped Eve route, or `undefined` for the
 * create and info routes (which mint or read no existing session). Every
 * ID-addressed route is `/eve/v1/session/:sessionId[/{cancel,compact,clear,reset,stream}]`,
 * so the id is the first path segment after {@link EVE_SESSION_ROUTE_PREFIX}.
 */
export function eveSessionIdFromRequest(request: Request): string | undefined {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(EVE_SESSION_ROUTE_PREFIX)) return undefined;

  const rawSessionId = pathname.slice(EVE_SESSION_ROUTE_PREFIX.length).split("/", 1)[0];
  if (!rawSessionId) return undefined;

  try {
    return decodeURIComponent(rawSessionId);
  } catch {
    return rawSessionId;
  }
}

async function resolveRouteAuth(
  auth: AuthFn<Request> | readonly AuthFn<Request>[],
  request: Request,
): Promise<RouteAuthPrincipal | null> {
  // Mirror Eve's routeAuth walk: the first entry to return a principal wins;
  // null/undefined skips to the next; a thrown Forbidden/Unauthenticated
  // propagates untouched so its structured response is preserved.
  const chain = Array.isArray(auth) ? auth : [auth as AuthFn<Request>];
  for (const authenticate of chain) {
    const principal = await authenticate(request);
    if (principal) return principal;
  }
  return null;
}

export type SessionOwnershipGuardDependencies = {
  /** The underlying route-auth policy (single fn or ordered array) that proves who is calling. */
  auth: AuthFn<Request> | readonly AuthFn<Request>[];
  /** Authoritative owner lookup for a session id; `null` means no binding exists. */
  getOwnerUserId: (sessionId: string) => Promise<string | null>;
};

/**
 * The single enforcement point for Eve session ownership. It authenticates the
 * caller through {@link SessionOwnershipGuardDependencies.auth}, then — for any
 * session-ID-addressed route (follow-up/message, stream, cancel, compact, clear,
 * reset) — requires the stored owner to equal the caller. A missing binding or a
 * mismatch fails closed with an opaque {@link EveSessionNotFoundError} (404). The
 * create and info routes carry no session id and pass through to authentication
 * alone. Wrapping every route in one guard means a newly added session route
 * cannot silently bypass the ownership check.
 */
export function createSessionOwnershipGuard(
  deps: SessionOwnershipGuardDependencies,
): AuthFn<Request> {
  return async (request) => {
    const principal = await resolveRouteAuth(deps.auth, request);
    if (!principal) return null;

    const sessionId = eveSessionIdFromRequest(request);
    if (sessionId === undefined) return principal;

    const ownerUserId = await deps.getOwnerUserId(sessionId);
    if (ownerUserId === null || ownerUserId !== principal.principalId) {
      throw new EveSessionNotFoundError();
    }

    return principal;
  };
}

/** Preserve the demo owner only behind Eve's loopback-only local authenticator. */
export function createLocalOwnerAuth(
  authenticateLocal: AuthFn<Request> = localDev(),
  env: LocalOwnerEnvironment = process.env,
): AuthFn<Request> {
  return async (request) => {
    const local = await authenticateLocal(request);
    if (!local) return null;

    return {
      attributes: { channel: "eve" },
      authenticator: "tendnote-local-dev",
      principalId: env.TENDNOTE_DEV_OWNER_USER_ID?.trim() || "demo-user",
      principalType: "user",
    };
  };
}
