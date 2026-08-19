import { type AuthFn, ForbiddenError, localDev, UnauthenticatedError } from "eve/channels/auth";

type SessionAuthDependencies = {
  getSession: (headers: Headers) => Promise<{ user: { id: string; email?: string | null } } | null>;
  /** Shared Web/Eve admission resolver; checkAccess is retained for narrow callers/tests. */
  resolveAccess?: (entity: {
    userId: string;
    email?: string | null;
  }) => Promise<{ admitted: boolean }>;
  checkAccess?: (userId: string) => Promise<{ admitted: boolean }>;
  checkIngressBudget: (userId: string) => Promise<{ allowed: boolean }>;
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
      ? await deps.resolveAccess({ userId, email: session.user.email })
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

type LocalOwnerEnvironment = { TENDNOTE_DEV_OWNER_USER_ID?: string };

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
