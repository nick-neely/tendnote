import type { AccessDecision } from "@tendnote/domain";
import type { LegalDocument } from "@tendnote/domain/legal-documents";

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

/** Where the re-acceptance gate lives (#614). */
export const REACCEPTANCE_PATH = "/accept-terms";

/** Where a Lapsed Account lives: resubscribe, export, delete (#609). */
export const LAPSED_PATH = "/lapsed";

/** Where a live Household Guest lands: read-only, outside the app shell (#635). */
export const GUEST_PATH = "/guest";

/**
 * Resolved Private Beta Access for the current request. `admitted` carries the
 * owner id used to scope product data; `pending` carries identity only so the
 * limited pending-access area can render without loading relationship data.
 *
 * `lapsed` is a not-admitted account whose Paid Access ended (#609). It carries
 * the retention deadline set once on entering Lapsed, and no owner id.
 *
 * `guest` is a hosted account that is not admitted but is a live Household
 * Guest (ADR 0245). It carries no owner id either, so every product surface
 * keyed on admission refuses it; only the guest area reads its household.
 *
 * `reacceptance` is any signed-in account, admitted or not, that owes
 * acceptance of a flagged document version (#614). It carries no owner id, so
 * everything keyed on admission fails closed; its `decision` is kept only so
 * export can still serve the account admission would otherwise admit.
 */
export type AccessState =
  | { state: "unauthenticated" }
  | { state: "pending"; user: SessionUser; decision: AccessDecision }
  | { state: "lapsed"; user: SessionUser; decision: AccessDecision; retentionDeadline: Date }
  | { state: "admitted"; user: SessionUser; ownerUserId: string; decision: AccessDecision }
  | { state: "guest"; user: SessionUser; householdId: string; decision: AccessDecision }
  | {
      state: "reacceptance";
      user: SessionUser;
      decision: AccessDecision;
      documents: readonly LegalDocument[];
    };

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
  readOutstandingReacceptance: (
    userId: string,
  ) => Promise<readonly LegalDocument[]> = async () => [],
): Promise<AccessState> {
  if (!user) {
    return { state: "unauthenticated" };
  }

  const [decision, documents] = await Promise.all([
    resolveAccess({
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
    }),
    readOutstandingReacceptance(user.id),
  ]);

  if (documents.length > 0) {
    return { state: "reacceptance", user, decision, documents };
  }

  if (decision.admitted) {
    return { state: "admitted", user, ownerUserId: user.id, decision };
  }

  // Lapsed comes before guest: a Household Guest is an account that never
  // paid, while a Lapsed member keeps its memberships but its own area, with
  // exactly resubscribe, export, and delete (#609).
  const retentionDeadline = decision.profile?.retentionDeadline;
  if (retentionDeadline) return { state: "lapsed", user, decision, retentionDeadline };
  return decision.guest
    ? { state: "guest", user, householdId: decision.guest.householdId, decision }
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
  | {
      type: "redirect";
      to:
        | "/sign-in"
        | "/pending"
        | typeof LAPSED_PATH
        | typeof GUEST_PATH
        | typeof REACCEPTANCE_PATH;
    };

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
    case "lapsed":
      return { type: "redirect", to: LAPSED_PATH };
    case "guest":
      return { type: "redirect", to: GUEST_PATH };
    case "reacceptance":
      return { type: "redirect", to: REACCEPTANCE_PATH };
    default:
      return options.localFallbackOwnerUserId
        ? { type: "admitted", ownerUserId: options.localFallbackOwnerUserId }
        : { type: "redirect", to: "/sign-in" };
  }
}

/**
 * The account a signed-in request speaks for, admitted or not. Only an
 * account's own exits use this: export and deletion stay open to a
 * not-admitted account, so leaving with its data is never blocked (#607).
 * Everything that touches the product goes through {@link decideAccessRoute};
 * a new access state must be decided in both.
 */
export function accountOwnerUserId(
  state: AccessState,
  options: { localFallbackOwnerUserId?: string } = {},
): string | null {
  switch (state.state) {
    case "admitted":
      return state.ownerUserId;
    case "pending":
    case "lapsed":
    case "guest":
    case "reacceptance":
      // Refusing new terms never blocks export or deletion (#614).
      return state.user.id;
    default:
      return options.localFallbackOwnerUserId ?? null;
  }
}

/**
 * Resolve an {@link AccessRoute} to an owner id for a server action, throwing a
 * user-safe error instead of redirecting. A mutation by an unauthenticated or
 * pending caller (e.g. a stale client) fails closed rather than proceeding.
 */
export function ownerForActionOrThrow(route: AccessRoute): string {
  if (route.type === "redirect") {
    throw new Error(ACTION_REFUSALS[route.to]);
  }

  return route.ownerUserId;
}

const ACTION_REFUSALS: Record<Extract<AccessRoute, { type: "redirect" }>["to"], string> = {
  "/sign-in": "You must be signed in to do that.",
  "/pending": "Private Beta Access is required to do that.",
  [LAPSED_PATH]: "Your subscription has ended. Resubscribe to do that.",
  [GUEST_PATH]: "A Household Guest can read the household but not change anything.",
  [REACCEPTANCE_PATH]: "Accept the updated terms to do that.",
};
