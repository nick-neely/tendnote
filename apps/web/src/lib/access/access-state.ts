import type { AccessDecision } from "@tendnote/domain";

/** The identity fields a pending or admitted user may see about themselves. */
export type SessionUser = {
  id: string;
  email: string;
  /**
   * Whether the session has proven ownership of {@link email}. Threaded from the
   * trusted Better Auth session into admission so the self-hosted bootstrap owner
   * role cannot be claimed by an unverified public credential signup.
   */
  emailVerified: boolean;
  name: string;
  image?: string | null;
};

/**
 * Resolved Private Beta Access for the current request. `admitted` carries the
 * owner id used to scope product data; `pending` carries identity only so the
 * limited pending-access area can render without loading relationship data.
 */
export type AccessState =
  | { state: "unauthenticated" }
  | { state: "pending"; user: SessionUser; decision: AccessDecision }
  | { state: "admitted"; user: SessionUser; ownerUserId: string; decision: AccessDecision };

/**
 * Map a trusted session user (or `null` after sign-out / before sign-in) and a
 * Private Beta Access decision into an {@link AccessState}. Pure and injectable so
 * the access boundary can be tested without a live session or flag provider.
 */
export async function resolveAccessState(
  user: SessionUser | null,
  resolveAccess: (entity: {
    userId: string;
    email?: string | null;
    emailVerified?: boolean;
  }) => Promise<AccessDecision>,
): Promise<AccessState> {
  if (!user) {
    return { state: "unauthenticated" };
  }

  const decision = await resolveAccess({
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
  });

  return decision.admitted
    ? { state: "admitted", user, ownerUserId: user.id, decision }
    : { state: "pending", user, decision };
}

const LOCAL_DEMO_OWNER_USER_ID = "demo-user";

/**
 * The local-development-only fallback owner. Returns `undefined` in production so
 * hosted preview/production requests can never be admitted without a real
 * admitted session — the demo owner is an explicit local convenience only.
 */
export function localFallbackOwnerUserId(env: {
  nodeEnv?: string;
  devOwnerUserId?: string;
}): string | undefined {
  if (env.nodeEnv === "production") {
    return undefined;
  }

  return env.devOwnerUserId ?? LOCAL_DEMO_OWNER_USER_ID;
}

/** Where a resolved access state should send the request. */
export type AccessRoute =
  | { type: "admitted"; ownerUserId: string }
  | { type: "redirect"; to: "/sign-in" | "/pending" };

/**
 * Pure routing decision for a resolved access state, shared by every gated
 * surface. A local-dev fallback owner is admitted only when one is supplied,
 * which callers do exclusively outside production — hosted requests never pass
 * one, so an unauthenticated hosted visitor is always redirected to sign-in.
 */
export function decideAccessRoute(
  state: AccessState,
  options: { localFallbackOwnerUserId?: string } = {},
): AccessRoute {
  switch (state.state) {
    case "admitted":
      return { type: "admitted", ownerUserId: state.ownerUserId };
    case "pending":
      return { type: "redirect", to: "/pending" };
    default:
      return options.localFallbackOwnerUserId
        ? { type: "admitted", ownerUserId: options.localFallbackOwnerUserId }
        : { type: "redirect", to: "/sign-in" };
  }
}

/**
 * Resolve an {@link AccessRoute} to an owner id for a server action, throwing a
 * user-safe error instead of redirecting. A mutation by an unauthenticated or
 * pending caller (e.g. a stale client) fails closed rather than proceeding.
 */
export function ownerForActionOrThrow(route: AccessRoute): string {
  if (route.type === "redirect") {
    throw new Error(
      route.to === "/pending"
        ? "Private Beta Access is required to do that."
        : "You must be signed in to do that.",
    );
  }

  return route.ownerUserId;
}
