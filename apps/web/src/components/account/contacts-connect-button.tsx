"use client";

import { GOOGLE_CONTACTS_READONLY_SCOPE } from "@tendnote/domain";
import { useState } from "react";
import { prepareGoogleContactsConnectAction } from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { ensureLocalDemoAuthSessionIfNeeded } from "@/lib/auth/local-demo-session-client";

/**
 * Starts the Google Contacts connect flow (Phase 2E, ADR-0107/0110). Uses Better
 * Auth's shared Google account link with the narrow personal Contacts read scope.
 * Reconciliation on return enforces the same linked Google identity as Calendar
 * and Gmail before marking the Contacts capability connected.
 */
export function ContactsConnectButton({
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
      await prepareGoogleContactsConnectAction();
      await authClient.linkSocial({
        provider: "google",
        scopes: [GOOGLE_CONTACTS_READONLY_SCOPE],
        callbackURL: "/account",
      });
    } catch {
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
