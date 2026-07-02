import {
  GOOGLE_CONTACTS_READONLY_SCOPE,
  hasContactsReadScope,
  PROVIDER_GOOGLE,
  type ProviderConnection,
} from "@tendnote/domain";
import {
  type ConnectCalendarFn,
  googleAccountIdentity,
  googleGrantedScopes,
  type LinkedAccountLike,
} from "./google-calendar-connection";

export const GOOGLE_CONTACTS_CAPABILITY = "contacts" as const;
export const CONTACTS_ACCOUNT_UNLINKED_REASON = "google_account_unlinked";
export const CONTACTS_LOCAL_DISCONNECT_REASON = "user_disconnect";
export const CONTACTS_IDENTITY_MISMATCH_MESSAGE =
  "Google Contacts must use the same linked Google account as existing Google capabilities.";

type GoogleCapabilityRef = {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
};

type RecordConnectionErrorFn = (
  input: GoogleCapabilityRef & { message: string },
) => Promise<unknown>;

export function deriveContactsConnection(
  accounts: readonly LinkedAccountLike[],
): { authorizedScopes: string[]; displayIdentity: string | null } | null {
  const scopes = googleGrantedScopes(accounts);
  if (!hasContactsReadScope(scopes)) {
    return null;
  }
  return { authorizedScopes: scopes, displayIdentity: googleAccountIdentity(accounts) };
}

function existingGoogleIdentity(
  connections: readonly ProviderConnection[] = [],
  capabilityKey: string,
): string | null {
  return (
    connections.find(
      (connection) =>
        connection.providerKey === PROVIDER_GOOGLE &&
        connection.capabilityKey !== capabilityKey &&
        connection.status === "connected" &&
        connection.displayIdentity,
    )?.displayIdentity ?? null
  );
}

function isLocallyDisconnected(
  connections: readonly ProviderConnection[] = [],
  capabilityKey: string,
): boolean {
  return connections.some(
    (connection) =>
      connection.providerKey === PROVIDER_GOOGLE &&
      connection.capabilityKey === capabilityKey &&
      connection.status === "revoked" &&
      connection.revocationReason === CONTACTS_LOCAL_DISCONNECT_REASON,
  );
}

export function hasGoogleIdentityMismatch(input: {
  displayIdentity: string | null;
  existingConnections?: readonly ProviderConnection[];
  capabilityKey?: string;
}): boolean {
  if (!input.displayIdentity) {
    return false;
  }
  const existing = existingGoogleIdentity(
    input.existingConnections,
    input.capabilityKey ?? GOOGLE_CONTACTS_CAPABILITY,
  );
  return Boolean(existing && existing !== input.displayIdentity);
}

export async function reconcileGoogleContactsConnection(input: {
  ownerUserId: string;
  accounts: readonly LinkedAccountLike[];
  existingConnections?: readonly ProviderConnection[];
  connect: ConnectCalendarFn;
  isConnected?: (ref: GoogleCapabilityRef) => Promise<boolean>;
  revoke?: (ref: GoogleCapabilityRef & { reason: string }) => Promise<unknown>;
  recordError?: RecordConnectionErrorFn;
}): Promise<unknown | null> {
  const ref: GoogleCapabilityRef = {
    ownerUserId: input.ownerUserId,
    providerKey: PROVIDER_GOOGLE,
    capabilityKey: GOOGLE_CONTACTS_CAPABILITY,
  };

  const derived = deriveContactsConnection(input.accounts);
  if (derived) {
    if (isLocallyDisconnected(input.existingConnections, GOOGLE_CONTACTS_CAPABILITY)) {
      return null;
    }

    if (
      hasGoogleIdentityMismatch({
        displayIdentity: derived.displayIdentity,
        existingConnections: input.existingConnections,
      })
    ) {
      return (
        input.recordError?.({
          ...ref,
          message: CONTACTS_IDENTITY_MISMATCH_MESSAGE,
        }) ?? null
      );
    }

    return input.connect({
      ...ref,
      displayIdentity: derived.displayIdentity,
      authorizedScopes: derived.authorizedScopes,
    });
  }

  if (input.isConnected && input.revoke && (await input.isConnected(ref))) {
    return input.revoke({ ...ref, reason: CONTACTS_ACCOUNT_UNLINKED_REASON });
  }
  return null;
}

export { GOOGLE_CONTACTS_READONLY_SCOPE };
