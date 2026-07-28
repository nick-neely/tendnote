"use client";

import { useTransition } from "react";
import { disconnectGoogleContactsAction } from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";

/**
 * Disconnects only the Google Contacts Provider Connection. Confirmed Tendnote
 * people/contact data remains Tendnote-owned and editable; future Contacts preview
 * reads are blocked by the revoked connection state.
 */
export function ContactsDisconnectButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      try {
        unwrapOwnerActionResult(await disconnectGoogleContactsAction());
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
