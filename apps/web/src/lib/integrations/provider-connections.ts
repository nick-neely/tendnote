import "server-only";

import {
  listProviderConnections,
  setProviderConnectionStatus,
} from "@tendnote/db/queries/provider-connections";
import type { ProviderConnectionStatus } from "@tendnote/domain";
import { requireAdmittedOwner, requireAdmittedOwnerForAction } from "@/lib/access/current-access";

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
  return listProviderConnections({ ownerUserId });
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
