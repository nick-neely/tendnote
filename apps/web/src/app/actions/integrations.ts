"use server";

import { z } from "zod";
import {
  configureOwnerDiscordTarget,
  setOwnerDiscordDeliveryEnabled,
} from "@/lib/integrations/discord-install-server";
import {
  disconnectOwnerDiscord,
  disconnectOwnerGoogleCalendar,
  disconnectOwnerGoogleContacts,
  prepareOwnerGoogleContactsConnect,
} from "@/lib/integrations/provider-connections";
import { runOwnerAction } from "@/lib/owner-action";

const emptyInputSchema = z.undefined();
const discordTargetSchema = z.object({
  guildId: z.string().min(1),
  targetChannelId: z.string().trim().min(1),
});
const discordDeliverySchema = z.object({
  guildId: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * Owner-scoped Google Calendar disconnect action (Phase 2C, ADR-0080). Delegates
 * to the audited product boundary (which resolves the admitted owner, revokes/
 * unlinks, clears the cache, and marks the connection revoked) and revalidates the
 * account page so connection health reflects the change.
 */
export async function disconnectGoogleCalendarAction() {
  return runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => disconnectOwnerGoogleCalendar({ ownerUserId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}

export async function disconnectGoogleContactsAction() {
  return runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => disconnectOwnerGoogleContacts({ ownerUserId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}

export async function prepareGoogleContactsConnectAction() {
  return runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => prepareOwnerGoogleContactsConnect({ ownerUserId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}

/**
 * Owner-scoped Discord disconnect action (ADR-0138). Delegates
 * to the audited product boundary (which resolves the admitted owner, unlinks the
 * Better Auth account, removes the persisted Discord identity mapping, and marks the
 * connection revoked) and revalidates the account page so the row reflects the change.
 */
export async function disconnectDiscordAction() {
  return runOwnerAction({
    schema: emptyInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => disconnectOwnerDiscord({ ownerUserId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
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
}) {
  return runOwnerAction({
    schema: discordTargetSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      configureOwnerDiscordTarget({ ownerUserId, ...parsed }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => undefined,
  });
}

/**
 * Pause or resume proactive delivery for the owner's install in one guild without
 * removing the install or the separate Discord identity link.
 */
export async function setDiscordDeliveryEnabledAction(input: {
  guildId: string;
  enabled: boolean;
}) {
  return runOwnerAction({
    schema: discordDeliverySchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      setOwnerDiscordDeliveryEnabled({ ownerUserId, ...parsed }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => undefined,
  });
}
