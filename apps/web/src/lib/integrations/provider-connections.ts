import "server-only";

import {
  connectProviderConnection,
  listProviderConnections,
  setProviderConnectionStatus,
} from "@tendnote/db/queries/provider-connections";
import type { ProviderConnectionStatus } from "@tendnote/domain";
import { requireAdmittedOwner, requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { googleEnvFromProcess, isGoogleConfigured } from "@/lib/auth/social";
import { reconcileGoogleCalendarConnection } from "./google-calendar-connection";

/**
 * Hosted product boundary for reading Provider Connection state (#100, ADR-0069).
 *
 * Resolves the admitted owner first, so pending-access and unauthenticated users
 * are redirected/denied before any connection state is read. This is the single
 * entry point the account page and future settings routes use; it never bypasses
 * the admitted-access gate.
 */
export async function getOwnerProviderConnections() {
  const ownerUserId = await requireAdmittedOwner();
  // Mirror live Google account-link state into the Calendar connection before
  // reading, so returning from the linkSocial flow shows `connected` (ADR-0071).
  // This is a read-path write by design: the mirror is owner-scoped (it persists
  // only for the just-resolved admitted owner, from that same session's accounts)
  // and idempotent (no row change ⇒ no audit entry), so it cannot affect another
  // owner. Best-effort: a transient provider/auth hiccup must not break the
  // account page (ADR-0081), so failures are swallowed and the persisted state is
  // read as-is. Durable auth/credential error mapping lands with the read and
  // disconnect slices (#108, #109) where real provider errors surface.
  await syncGoogleCalendarConnection(ownerUserId).catch(() => {});
  return listProviderConnections({ ownerUserId });
}

/**
 * Reconcile the owner's Better Auth Google account-link into their Calendar
 * Provider Connection. No-op unless Google is configured; the heavy/RSC-only deps
 * (Better Auth server, request headers) are imported lazily so this stays inert —
 * and unit tests stay deterministic — when Calendar is not wired. The connected
 * identity and scopes come from the linked Google account, never the session.
 */
async function syncGoogleCalendarConnection(ownerUserId: string): Promise<void> {
  if (!isGoogleConfigured(googleEnvFromProcess())) {
    return;
  }
  const [{ getAuth }, { headers }] = await Promise.all([
    import("@/lib/auth/server"),
    import("next/headers"),
  ]);
  const accounts = await getAuth().api.listUserAccounts({ headers: await headers() });
  await reconcileGoogleCalendarConnection({
    ownerUserId,
    accounts: accounts ?? [],
    connect: connectProviderConnection,
  });
}

/**
 * Hosted product boundary for changing Provider Connection status. Resolves the
 * admitted owner via the action gate (which throws, failing closed, for pending or
 * unauthenticated callers) before any state is mutated, and scopes the change to
 * that owner. Phase 2B affordances stay inert; future provider slices call this.
 */
export async function setOwnerProviderConnectionStatus(input: {
  providerKey: string;
  capabilityKey: string;
  status: ProviderConnectionStatus;
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return setProviderConnectionStatus({ ownerUserId, ...input });
}
