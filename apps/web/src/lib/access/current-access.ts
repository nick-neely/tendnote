import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/server";
import { type AccessState, decideAccessRoute, resolveAccessState } from "./access-state";
import { privateBetaAccess } from "./private-beta-flag";

const localDemoOwnerUserId = "demo-user";

/**
 * Resolve Private Beta Access for the current request from the trusted Better
 * Auth session. Returns identity-only state for pending users so callers can
 * render the limited pending area without touching relationship data.
 */
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

/**
 * The local-development-only fallback owner. Returns `undefined` in production so
 * hosted requests can never be admitted without a real admitted session.
 */
function localFallbackOwnerUserId(): string | undefined {
  if (process.env.NODE_ENV === "production") {
    return undefined;
  }

  return process.env.TENDNOTE_DEV_OWNER_USER_ID ?? localDemoOwnerUserId;
}

/**
 * Page-level access gate and owner resolver. Returns the admitted owner id, or
 * redirects pending users to the limited pending area and unauthenticated hosted
 * users to sign-in. This is the single owner-resolution path for app pages.
 */
export async function requireAdmittedOwner(): Promise<string> {
  const state = await getCurrentAccess();
  const route = decideAccessRoute(state, {
    localFallbackOwnerUserId: localFallbackOwnerUserId(),
  });

  if (route.type === "redirect") {
    redirect(route.to);
  }

  return route.ownerUserId;
}
