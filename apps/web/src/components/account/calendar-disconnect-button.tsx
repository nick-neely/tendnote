"use client";

import { useTransition } from "react";
import { disconnectGoogleCalendarAction } from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";

/**
 * Disconnects Google Calendar (Phase 2C, ADR-0080). Calls the audited server
 * action, which revokes/unlinks the Google grant, clears the Calendar cache, marks
 * the connection revoked, and revalidates the page — so the row re-renders as
 * disconnected (and surfaces any remaining Google cleanup) on completion.
 */
export function CalendarDisconnectButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      try {
        await disconnectGoogleCalendarAction();
      } catch {
        // The connection state is unchanged; the page reflects reality on reload.
      }
    });
  }

  return (
    <Button
      aria-label={`Disconnect ${label}`}
      disabled={pending}
      onClick={disconnect}
      size="sm"
      variant="outline"
    >
      {pending ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}
