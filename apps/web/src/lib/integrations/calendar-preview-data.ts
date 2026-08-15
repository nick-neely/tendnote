import "server-only";

import {
  createDefaultCalendarReader,
  createGoogleCalendarAdapter,
  readConnectedOwnerCalendar,
} from "@tendnote/db/queries/calendar";
import { recordProviderConnectionError } from "@tendnote/db/queries/provider-connections";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { googleEnvFromProcess, isGoogleConfigured } from "@/lib/auth/social";
import {
  buildCalendarPreviewView,
  type CalendarPreviewTarget,
  type CalendarPreviewView,
} from "./calendar-preview";

// A glance-sized bounded window: recent (to catch an in-progress meeting) through
// the next week, a handful of events.
const PREVIEW_LOOKBACK_MS = 60 * 60 * 1000;
const PREVIEW_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_MAX_RESULTS = 6;
const CALENDAR_REAUTH_MESSAGE =
  "Google Calendar needs to be reconnected. Use Connect in Integrations to restore access.";

/**
 * Build the account-page Calendar preview for the admitted owner (Phase 2C, #110).
 * Hidden unless Google is configured and the Calendar connection is connected;
 * reads a bounded minimized window through the shared cache-aside reader and
 * degrades to a calm `unavailable` state on any provider/token failure (ADR-0081).
 * The connection's read-gate (`isProviderCapabilityConnected`) means a disconnected
 * owner never reaches a live read.
 */
export async function getOwnerCalendarPreview(
  target: CalendarPreviewTarget | null = null,
): Promise<CalendarPreviewView> {
  const ownerUserId = await requireAdmittedOwner();
  const now = new Date();

  if (!isGoogleConfigured(googleEnvFromProcess())) {
    return buildCalendarPreviewView({ connected: false, result: null, now });
  }

  const ref = { ownerUserId, providerKey: "google", capabilityKey: "calendar" };
  const targetEventId = target ? `${target.calendarId}:${target.providerEventId}` : undefined;

  const [{ getAuth }, { headers }] = await Promise.all([
    import("@/lib/auth/server"),
    import("next/headers"),
  ]);
  const requestHeaders = await headers();

  const adapter = createGoogleCalendarAdapter({
    getAccessToken: async () => {
      const token = await getAuth().api.getAccessToken({
        body: { providerId: "google" },
        headers: requestHeaders,
      });
      const accessToken = (token as { accessToken?: string } | null)?.accessToken;
      if (!accessToken) {
        throw new Error("No Google access token available.");
      }
      return accessToken;
    },
  });

  // Shared owner-scoped read: gates on the connection, reads the bounded window,
  // and degrades gracefully — the same seam Eve and the brief dispatcher use.
  const { connected, result, requiresReauthorization } = await readConnectedOwnerCalendar(
    {
      ...ref,
      calendarId: target?.calendarId,
      timeMin: target
        ? new Date(target.start.getTime() - PREVIEW_LOOKBACK_MS)
        : new Date(now.getTime() - PREVIEW_LOOKBACK_MS),
      timeMax: target
        ? new Date(target.start.getTime() + PREVIEW_LOOKAHEAD_MS)
        : new Date(now.getTime() + PREVIEW_LOOKAHEAD_MS),
      maxResults: target ? 50 : PREVIEW_MAX_RESULTS,
      query: target?.query,
    },
    {
      reader: createDefaultCalendarReader(adapter),
      onAuthorizationFailure: async ({ ref, error }) => {
        // Keep runtime diagnostics useful without ever logging tokens or provider
        // payloads. The persisted message is similarly safe and user-actionable.
        console.warn("[tendnote] Google Calendar authorization failed", {
          ownerUserId: ref.ownerUserId,
          failureKind: error.kind,
          providerStatus: error.status ?? null,
        });
        await recordProviderConnectionError({ ...ref, message: CALENDAR_REAUTH_MESSAGE });
      },
    },
  );

  return buildCalendarPreviewView({
    connected,
    result,
    requiresReauthorization,
    now,
    targetEventId,
  });
}
