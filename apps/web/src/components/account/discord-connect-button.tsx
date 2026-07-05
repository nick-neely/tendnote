"use client";

import { DISCORD_IDENTIFY_SCOPE } from "@tendnote/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { ensureLocalDemoAuthSessionIfNeeded } from "@/lib/auth/local-demo-session-client";

/**
 * Starts the real Discord connect flow (ADR-0138). Uses Better
 * Auth's `linkSocial` so Discord is linked to the signed-in Tendnote account with a
 * single `identify` scope — Better Auth performs the OAuth redirect and owns token
 * custody. On return the account page reconciles the persisted Discord identity and
 * connection, so no token or provider URL is ever handled here. `identify` (not
 * `email`) means phone-only Discord accounts link without an email identity.
 */
export function DiscordConnectButton({
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
        provider: "discord",
        scopes: [DISCORD_IDENTIFY_SCOPE],
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
