"use server";

import { revalidatePath } from "next/cache";
import type { DisconnectDiscordResult } from "@/lib/integrations/discord-disconnect";
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
  const result = await disconnectOwnerGoogleCalendar();
  revalidatePath("/account");
  return result;
}

export async function disconnectGoogleContactsAction() {
  const result = await disconnectOwnerGoogleContacts();
  revalidatePath("/account");
  return result;
}

export async function prepareGoogleContactsConnectAction() {
  const result = await prepareOwnerGoogleContactsConnect();
  revalidatePath("/account");
  return result;
}

/**
 * Owner-scoped Discord disconnect action (ADR-0138). Delegates
 * to the audited product boundary (which resolves the admitted owner, unlinks the
 * Better Auth account, removes the persisted Discord identity mapping, and marks the
 * connection revoked) and revalidates the account page so the row reflects the change.
 */
export async function disconnectDiscordAction(): Promise<DisconnectDiscordResult> {
  const result = await disconnectOwnerDiscord();
  revalidatePath("/account");
  return result;
}
