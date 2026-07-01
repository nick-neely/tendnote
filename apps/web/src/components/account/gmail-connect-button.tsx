"use client";

import { GOOGLE_GMAIL_COMPOSE_SCOPE } from "@tendnote/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

/**
 * Starts the real Gmail connect flow (Phase 2D, ADR-0090). Uses Better Auth's
 * `linkSocial` incremental consent to add the single narrow Gmail draft-write scope
 * to the owner's linked Google account — Better Auth performs the OAuth redirect and
 * owns token custody. Requesting only `gmail.compose` (not read/history/send) keeps
 * Gmail's grant narrow and independent of Calendar. On return the account page
 * reconciles the Gmail connection, so no token or provider URL is handled here.
 */
export function GmailConnectButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    try {
      await authClient.linkSocial({
        provider: "google",
        scopes: [GOOGLE_GMAIL_COMPOSE_SCOPE],
        callbackURL: "/account",
      });
    } catch {
      // Surface failure by re-enabling the control; the connection state stays
      // unchanged and the page's connection health reflects reality on next load.
      setPending(false);
    }
  }

  return (
    <Button
      aria-label={`Connect ${label}`}
      disabled={pending}
      onClick={connect}
      size="sm"
      variant="outline"
    >
      {pending ? "Connecting…" : "Connect"}
    </Button>
  );
}
