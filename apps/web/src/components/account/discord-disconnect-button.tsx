"use client";

import { useTransition } from "react";
import { disconnectDiscordAction } from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";

/**
 * Disconnects Discord (ADR-0138). Calls the audited server
 * action, which unlinks the Better Auth Discord account, removes the persisted
 * Discord identity mapping (so inbound Discord captures no longer resolve to this
 * owner), marks the connection revoked, and revalidates the page — so the row
 * re-renders as disconnected on completion.
 */
export function DiscordDisconnectButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      try {
        unwrapOwnerActionResult(await disconnectDiscordAction());
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
