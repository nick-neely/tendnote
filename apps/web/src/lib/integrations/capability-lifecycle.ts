import {
  PROVIDER_DISCORD,
  PROVIDER_GOOGLE,
  type ProviderCapabilityRef,
  type ProviderConnection,
  providerCapabilityKey,
} from "@tendnote/domain";
import {
  DISCORD_CHANNEL_CAPABILITY,
  type LinkDiscordIdentityFn,
  type LinkedDiscordAccountLike,
  type MappedDiscordIdentity,
  reconcileDiscordConnection,
} from "./discord-connection";
import {
  GOOGLE_CALENDAR_CAPABILITY,
  type LinkedAccountLike,
  reconcileGoogleCalendarConnection,
} from "./google-calendar-connection";
import {
  GOOGLE_CONTACTS_CAPABILITY,
  reconcileGoogleContactsConnection,
} from "./google-contacts-connection";
import { GOOGLE_GMAIL_CAPABILITY, reconcileGoogleGmailConnection } from "./google-gmail-connection";

/**
 * Provider-connection capability lifecycle registry (epic #223).
 *
 * The provider-connection catalog (`DEFAULT_PROVIDER_CAPABILITIES`, ADR-0069) is the
 * single source of *which* capabilities Tendnote offers. This registry is the single
 * source of the *lifecycle behavior* each offered capability must have — one reconcile
 * binding per capability, plus a declarative disconnect descriptor the account UI reads.
 *
 * It exists to concentrate what was previously duplicated: the imperative enumeration
 * of "reconcile Calendar, then Gmail, then Contacts, then Discord" (restated across two
 * `sync*` functions and a doubled `listUserAccounts` read), and the implicit,
 * scattered knowledge of which capability supports which disconnect and which entry
 * points. The provider-specific *rules* stay behind their existing pure adapters
 * (`reconcile*Connection`) — this only binds the catalog to them and drives them
 * uniformly. A catalog-completeness test (`capability-lifecycle.test.ts`) fails when an
 * offered capability lacks a lifecycle binding, so an added capability cannot silently
 * ship without reconcile wiring.
 *
 * Pure: no `server-only`, Better Auth, `next`, or DB imports. All I/O — listing linked
 * accounts, connecting/revoking, resolving Discord identity/username — is injected via
 * `CapabilityReconcileContext`, so the registry is unit-tested with fakes and the
 * server glue lives in the `provider-connections` boundary.
 */

/**
 * A Better Auth linked account as the reconcile adapters read it. The Google and
 * Discord adapters each filter this shared list to their own provider, so one
 * `listUserAccounts` read backs every capability's reconcile.
 */
export type LinkedProviderAccount = LinkedAccountLike & LinkedDiscordAccountLike;

/** Owner-scoped connect mutation shared by every capability's reconcile. */
export type ConnectCapabilityFn = (input: {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
  displayIdentity?: string | null;
  authorizedScopes?: string[] | null;
}) => Promise<unknown>;

/** Owner-scoped provider-capability reference shared by every context dependency. */
export type OwnedCapabilityRef = ProviderCapabilityRef & { ownerUserId: string };

type CapabilityRefWithReason = OwnedCapabilityRef & { reason: string };

type CapabilityRefWithMessage = OwnedCapabilityRef & { message: string };

/**
 * The injected dependencies every capability reconcile draws from. Each capability
 * uses only the subset its rules require (Calendar needs `connect`; Discord also needs
 * identity resolution) — the context is a dependency bag, not a flattening of the
 * provider rules, which stay in the adapters.
 */
export type CapabilityReconcileContext = {
  ownerUserId: string;
  /** The owner's Better Auth linked accounts; each adapter filters to its provider. */
  accounts: readonly LinkedProviderAccount[];
  /** Persisted connections, for identity-mismatch and local-disconnect checks. */
  existingConnections: readonly ProviderConnection[];
  /** Providers whose server credentials are configured; others never mirror. */
  enabledProviders: ReadonlySet<string>;
  connect: ConnectCapabilityFn;
  isConnected: (ref: OwnedCapabilityRef) => Promise<boolean>;
  revoke: (input: CapabilityRefWithReason) => Promise<unknown>;
  recordError: (input: CapabilityRefWithMessage) => Promise<unknown>;
  /** The owner + display identity a Discord user id currently maps to, or null. */
  getIdentity: (discordUserId: string) => Promise<MappedDiscordIdentity | null>;
  /** Resolve a human-verifiable Discord display identity at link time (best-effort). */
  fetchUsername: () => Promise<string | null>;
  linkIdentity: LinkDiscordIdentityFn;
};

/**
 * How a capability's explicit disconnect behaves. Declarative so the account UI keys its
 * post-disconnect cleanup copy off the disconnect semantics (`provider_grant`) rather
 * than a `capabilityKey === "calendar"` literal (see `provider-connections-section.tsx`),
 * and so a test cross-checks that the UI wires a disconnect affordance for exactly the
 * capabilities with a non-null kind. `null` marks a capability with no independent
 * disconnect (Gmail rides the shared Google account's Calendar disconnect, ADR-0090).
 *
 * - `provider_grant`: revoke the provider grant + unlink; local cache cleared; a note
 *   tells the owner to finish revocation at the provider when the grant survived
 *   (Calendar, ADR-0080).
 * - `local_keep_data`: local opt-out only; confirmed Tendnote-owned data is retained
 *   (Contacts, ADR-0121).
 * - `identity_unlink`: revoke + unlink + remove owner-scoped identity mapping so
 *   inbound capture fails closed (Discord, ADR-0138).
 */
export type CapabilityDisconnectKind = "provider_grant" | "local_keep_data" | "identity_unlink";

export type CapabilityLifecycle = {
  providerKey: string;
  capabilityKey: string;
  /** Mirror the provider account-link into this capability's connection. */
  reconcile: (context: CapabilityReconcileContext) => Promise<void>;
  /** Declarative disconnect behavior, or null when the capability has no own disconnect. */
  disconnect: CapabilityDisconnectKind | null;
};

/**
 * Lifecycle binding for each offered capability. Order mirrors
 * `DEFAULT_PROVIDER_CAPABILITIES`. Each `reconcile` is a thin closure that hands the
 * shared context to the capability's existing pure adapter — the reconcile rules are
 * unchanged and unit-tested where they live.
 */
export const CAPABILITY_LIFECYCLE: readonly CapabilityLifecycle[] = [
  {
    providerKey: PROVIDER_GOOGLE,
    capabilityKey: GOOGLE_CALENDAR_CAPABILITY,
    disconnect: "provider_grant",
    reconcile: async (context) => {
      await reconcileGoogleCalendarConnection({
        ownerUserId: context.ownerUserId,
        accounts: context.accounts,
        connect: context.connect,
      });
    },
  },
  {
    providerKey: PROVIDER_GOOGLE,
    capabilityKey: GOOGLE_GMAIL_CAPABILITY,
    // Gmail shares the Google account link and is downgraded when that link is unlinked
    // out from under it (ADR-0090); it has no independent disconnect affordance.
    disconnect: null,
    reconcile: async (context) => {
      await reconcileGoogleGmailConnection({
        ownerUserId: context.ownerUserId,
        accounts: context.accounts,
        connect: context.connect,
        isConnected: context.isConnected,
        revoke: context.revoke,
      });
    },
  },
  {
    providerKey: PROVIDER_GOOGLE,
    capabilityKey: GOOGLE_CONTACTS_CAPABILITY,
    disconnect: "local_keep_data",
    reconcile: async (context) => {
      await reconcileGoogleContactsConnection({
        ownerUserId: context.ownerUserId,
        accounts: context.accounts,
        existingConnections: context.existingConnections,
        connect: context.connect,
        isConnected: context.isConnected,
        revoke: context.revoke,
        recordError: context.recordError,
      });
    },
  },
  {
    providerKey: PROVIDER_DISCORD,
    capabilityKey: DISCORD_CHANNEL_CAPABILITY,
    disconnect: "identity_unlink",
    reconcile: async (context) => {
      await reconcileDiscordConnection({
        ownerUserId: context.ownerUserId,
        accounts: context.accounts,
        getIdentity: context.getIdentity,
        fetchUsername: context.fetchUsername,
        linkIdentity: context.linkIdentity,
        connect: async (input) => {
          await context.connect(input);
        },
        recordError: async (input) => {
          await context.recordError(input);
        },
      });
    },
  },
];

/** Look up a capability's lifecycle binding, or `undefined` for an unknown ref. */
export function capabilityLifecycle(ref: ProviderCapabilityRef): CapabilityLifecycle | undefined {
  return CAPABILITY_LIFECYCLE.find(
    (entry) => entry.providerKey === ref.providerKey && entry.capabilityKey === ref.capabilityKey,
  );
}

/** The declarative disconnect kind for a capability, or `null` when it has no own disconnect. */
export function capabilityDisconnectKind(
  ref: ProviderCapabilityRef,
): CapabilityDisconnectKind | null {
  return capabilityLifecycle(ref)?.disconnect ?? null;
}

/**
 * Drive every offered capability's reconcile from the catalog, skipping providers whose
 * server credentials are not configured. Failures are isolated per capability (via
 * `onError`, defaulting to swallow) so one provider's transient failure never blocks
 * another's mirror — this is the best-effort read-path posture the account page relies
 * on (ADR-0081). Returns nothing; each reconcile writes owner-scoped state through its
 * injected mutations.
 */
export async function reconcileOwnerCapabilities(
  context: CapabilityReconcileContext,
  options: { onError?: (ref: ProviderCapabilityRef, error: unknown) => void } = {},
): Promise<void> {
  await Promise.all(
    CAPABILITY_LIFECYCLE.filter((entry) => context.enabledProviders.has(entry.providerKey)).map(
      async (entry) => {
        try {
          await entry.reconcile(context);
        } catch (error) {
          options.onError?.(
            { providerKey: entry.providerKey, capabilityKey: entry.capabilityKey },
            error,
          );
        }
      },
    ),
  );
}

/** Stable composite keys for every catalog capability, for completeness assertions. */
export function lifecycleCapabilityKeys(): string[] {
  return CAPABILITY_LIFECYCLE.map(providerCapabilityKey);
}
