"use client";

import { GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from "@tendnote/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { ensureLocalDemoAuthSessionIfNeeded } from "@/lib/auth/local-demo-session-client";

/**
 * Starts the real Google Calendar connect flow (Phase 2C, ADR-0071). Uses Better
 * Auth's `linkSocial` so Calendar is linked to the signed-in Tendnote account with
 * a single feature-specific scope — Better Auth performs the OAuth redirect and
 * owns token custody. On return the account page reconciles the connection, so no
 * token or provider URL is ever handled here.
 */
export function CalendarConnectButton({
  ensureLocalDemoAuthSession = false,
  label,
}: {
  ensureLocalDemoAuthSession?: boolean;
  label: string;
}) {
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    try {
      await ensureLocalDemoAuthSessionIfNeeded(ensureLocalDemoAuthSession);
      await authClient.linkSocial({
        provider: "google",
        scopes: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE],
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
