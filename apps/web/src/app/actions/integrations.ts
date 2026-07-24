"use server";

import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import {
  accountMutationScopes,
  updateAccountMutationScopes,
} from "@/lib/cache/account-mutation-scopes";
import type { DisconnectDiscordResult } from "@/lib/integrations/discord-disconnect";
import {
  configureOwnerDiscordTarget,
  setOwnerDiscordDeliveryEnabled,
} from "@/lib/integrations/discord-install-server";
import type { DisconnectGoogleCalendarResult } from "@/lib/integrations/google-calendar-disconnect";
import {
  disconnectOwnerDiscord,
  disconnectOwnerGoogleCalendar,
  disconnectOwnerGoogleContacts,
  prepareOwnerGoogleContactsConnect,
} from "@/lib/integrations/provider-connections";

/**
 * Owner-scoped Google Calendar disconnect action (Phase 2C, ADR-0080). Delegates
 * to the audited product boundary (which resolves the admitted owner, revokes/
 * unlinks, clears the cache, and marks the connection revoked) and revalidates the
 * account page so connection health reflects the change.
 */
export async function disconnectGoogleCalendarAction(): Promise<DisconnectGoogleCalendarResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await disconnectOwnerGoogleCalendar();
  updateAccountMutationScopes(accountMutationScopes.forOwner(ownerUserId));
  return result;
}

export async function disconnectGoogleContactsAction() {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await disconnectOwnerGoogleContacts();
  updateAccountMutationScopes(accountMutationScopes.forOwner(ownerUserId));
  return result;
}

export async function prepareGoogleContactsConnectAction() {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await prepareOwnerGoogleContactsConnect();
  updateAccountMutationScopes(accountMutationScopes.forOwner(ownerUserId));
  return result;
}

/**
 * Owner-scoped Discord disconnect action (ADR-0138). Delegates
 * to the audited product boundary (which resolves the admitted owner, unlinks the
 * Better Auth account, removes the persisted Discord identity mapping, and marks the
 * connection revoked) and revalidates the account page so the row reflects the change.
 */
export async function disconnectDiscordAction(): Promise<DisconnectDiscordResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await disconnectOwnerDiscord();
  updateAccountMutationScopes(accountMutationScopes.forOwner(ownerUserId));
  return result;
}

/**
 * Owner-scoped Discord delivery-target configuration (issue #173, ADR-0139).
 * Sets the channel a proactive nudge lands in for the owner's install in one
 * guild; the boundary resolves the admitted owner (throws, failing closed, for
 * pending/unauthenticated callers) and only ever touches that owner's row.
 */
export async function configureDiscordTargetAction(input: {
  guildId: string;
  targetChannelId: string;
}): Promise<void> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  await configureOwnerDiscordTarget({
    guildId: input.guildId,
    targetChannelId: input.targetChannelId.trim(),
  });
  updateAccountMutationScopes(accountMutationScopes.forOwner(ownerUserId));
}

/**
 * Pause or resume proactive delivery for the owner's install in one guild without
 * removing the install or the separate Discord identity link.
 */
export async function setDiscordDeliveryEnabledAction(input: {
  guildId: string;
  enabled: boolean;
}): Promise<void> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  await setOwnerDiscordDeliveryEnabled({ guildId: input.guildId, enabled: input.enabled });
  updateAccountMutationScopes(accountMutationScopes.forOwner(ownerUserId));
}
