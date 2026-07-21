import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { signInPathFor } from "../auth/return-to";
import {
  type AccessState,
  decideAccessRoute,
  localFallbackOwnerUserId,
  ownerForActionOrThrow,
  resolveAccessState,
} from "./access-state";
import { privateBetaAccess } from "./private-beta-flag";

/**
 * Resolve Private Beta Access for the current request from the trusted Better
 * Auth session. Returns identity-only state for pending users so callers can
 * render the limited pending area without touching relationship data.
 */
// fallow-ignore-next-line complexity -- Session failure handling intentionally differs between production and local development.
export async function getCurrentAccess(): Promise<AccessState> {
  let session: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>> | null = null;

  try {
    session = await getAuth().api.getSession({ headers: await headers() });
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
  }

  const user = session?.user;
  const sessionUser = user
    ? { id: user.id, email: user.email, name: user.name, image: user.image }
    : null;

  return resolveAccessState(sessionUser, (entity) => privateBetaAccess.resolveAccess(entity));
}

/** Resolve the local-dev fallback owner from the live environment, if any. */
function currentLocalFallbackOwnerUserId(): string | undefined {
  return localFallbackOwnerUserId({
    nodeEnv: process.env.NODE_ENV,
    devOwnerUserId: process.env.TENDNOTE_DEV_OWNER_USER_ID,
  });
}

/**
 * Page-level access gate and owner resolver. Returns the admitted owner id, or
 * redirects pending users to the limited pending area and unauthenticated hosted
 * users to sign-in. This is the single owner-resolution path for app pages.
 */
export async function requireAdmittedOwner(input: { returnTo?: string } = {}): Promise<string> {
  const state = await getCurrentAccess();
  const route = decideAccessRoute(state, {
    localFallbackOwnerUserId: currentLocalFallbackOwnerUserId(),
  });

  if (route.type === "redirect") {
    redirect(route.to === "/sign-in" ? signInPathFor(input.returnTo) : route.to);
  }

  return route.ownerUserId;
}

/**
 * Server-action access gate and owner resolver. Like {@link requireAdmittedOwner}
 * but throws instead of redirecting, so a mutation triggered by an unauthenticated
 * or pending caller (e.g. a stale client) fails closed rather than silently
 * proceeding. Admitted callers — and the local-dev fallback owner outside
 * production — get their owner id.
 */
export async function requireAdmittedOwnerForAction(): Promise<string> {
  const state = await getCurrentAccess();
  const route = decideAccessRoute(state, {
    localFallbackOwnerUserId: currentLocalFallbackOwnerUserId(),
  });

  return ownerForActionOrThrow(route);
}

/**
 * Resolve the admitted owner id, or `null` when the caller is unauthenticated or
 * pending. Unlike {@link requireAdmittedOwner} it neither redirects nor throws, so
 * a fail-closed flow (e.g. the Discord install callback) can decide its own
 * outcome instead of a redirect. Uses the same single owner-resolution path.
 */
export async function admittedOwnerOrNull(): Promise<string | null> {
  const state = await getCurrentAccess();
  const route = decideAccessRoute(state, {
    localFallbackOwnerUserId: currentLocalFallbackOwnerUserId(),
  });

  return route.type === "admitted" ? route.ownerUserId : null;
}
