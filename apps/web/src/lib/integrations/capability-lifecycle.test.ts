import { DEFAULT_PROVIDER_CAPABILITIES, providerCapabilityKey } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_LIFECYCLE,
  type CapabilityReconcileContext,
  type ConnectCapabilityFn,
  capabilityDisconnectKind,
  capabilityLifecycle,
  lifecycleCapabilityKeys,
  reconcileOwnerCapabilities,
} from "./capability-lifecycle";
import { GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE } from "./google-calendar-connection";
import { GOOGLE_CONTACTS_READONLY_SCOPE } from "./google-contacts-connection";
import { GOOGLE_GMAIL_COMPOSE_SCOPE } from "./google-gmail-connection";

function baseContext(
  overrides: Partial<CapabilityReconcileContext> = {},
): CapabilityReconcileContext {
  return {
    ownerUserId: "user-1",
    accounts: [],
    existingConnections: [],
    enabledProviders: new Set(["google", "discord"]),
    connect: vi.fn(async () => undefined),
    isConnected: vi.fn(async () => false),
    revoke: vi.fn(async () => undefined),
    recordError: vi.fn(async () => undefined),
    getIdentity: vi.fn(async () => null),
    fetchUsername: vi.fn(async () => "Ada"),
    linkIdentity: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("catalog completeness", () => {
  it("binds a lifecycle with a reconcile to every offered catalog capability", () => {
    // The registry is the enforcement seam: an offered capability that lacks lifecycle
    // wiring fails here rather than silently never mirroring its connection state.
    for (const capability of DEFAULT_PROVIDER_CAPABILITIES) {
      const lifecycle = capabilityLifecycle(capability);
      expect(
        lifecycle,
        `no lifecycle bound for ${providerCapabilityKey(capability)}`,
      ).toBeDefined();
      expect(typeof lifecycle?.reconcile).toBe("function");
    }
  });

  it("has no lifecycle binding that is not an offered catalog capability", () => {
    const catalogKeys = new Set(DEFAULT_PROVIDER_CAPABILITIES.map(providerCapabilityKey));
    for (const key of lifecycleCapabilityKeys()) {
      expect(catalogKeys.has(key), `${key} is wired but not offered in the catalog`).toBe(true);
    }
  });

  it("covers exactly the offered capabilities, one binding each", () => {
    expect(lifecycleCapabilityKeys().sort()).toEqual(
      DEFAULT_PROVIDER_CAPABILITIES.map(providerCapabilityKey).sort(),
    );
    expect(new Set(lifecycleCapabilityKeys()).size).toBe(CAPABILITY_LIFECYCLE.length);
  });

  it("declares each capability's disconnect behavior explicitly", () => {
    // Distinct provider disconnect rules stay explicit rather than flattened: Calendar
    // revokes the provider grant, Contacts keeps Tendnote data, Discord unlinks identity,
    // and Gmail has no independent disconnect (rides the shared Google account link).
    expect(capabilityDisconnectKind({ providerKey: "google", capabilityKey: "calendar" })).toBe(
      "provider_grant",
    );
    expect(capabilityDisconnectKind({ providerKey: "google", capabilityKey: "contacts" })).toBe(
      "local_keep_data",
    );
    expect(capabilityDisconnectKind({ providerKey: "discord", capabilityKey: "channel" })).toBe(
      "identity_unlink",
    );
    expect(capabilityDisconnectKind({ providerKey: "google", capabilityKey: "gmail" })).toBeNull();
  });
});

describe("reconcileOwnerCapabilities", () => {
  it("mirrors each Google capability from its own granted scope through the shared account list", async () => {
    const connect = vi.fn<ConnectCapabilityFn>(async () => undefined);
    const context = baseContext({
      connect,
      accounts: [
        {
          providerId: "google",
          email: "owner@example.com",
          scopes: [
            GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
            GOOGLE_GMAIL_COMPOSE_SCOPE,
            GOOGLE_CONTACTS_READONLY_SCOPE,
          ],
        },
      ],
      enabledProviders: new Set(["google"]),
    });

    await reconcileOwnerCapabilities(context);

    const connectedCapabilities = connect.mock.calls.map((call) => call[0].capabilityKey).sort();
    expect(connectedCapabilities).toEqual(["calendar", "contacts", "gmail"]);
    // Each connect uses the linked Google identity, never a session email.
    for (const call of connect.mock.calls) {
      expect(call[0].displayIdentity).toBe("owner@example.com");
    }
  });

  it("connects only Calendar when only the Calendar scope is granted (Gmail stays independent)", async () => {
    const connect = vi.fn<ConnectCapabilityFn>(async () => undefined);
    const context = baseContext({
      connect,
      accounts: [{ providerId: "google", scopes: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE] }],
      enabledProviders: new Set(["google"]),
    });

    await reconcileOwnerCapabilities(context);

    expect(connect.mock.calls.map((call) => call[0].capabilityKey)).toEqual(["calendar"]);
  });

  it("links and connects Discord from the linked account, resolving a display identity once", async () => {
    const connect = vi.fn<ConnectCapabilityFn>(async () => undefined);
    const linkIdentity = vi.fn(async () => undefined);
    const fetchUsername = vi.fn(async () => "Ada Lovelace");
    const context = baseContext({
      connect,
      linkIdentity,
      fetchUsername,
      getIdentity: vi.fn(async () => null),
      accounts: [{ providerId: "discord", accountId: "discord-123" }],
      enabledProviders: new Set(["discord"]),
    });

    await reconcileOwnerCapabilities(context);

    expect(linkIdentity).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      discordUserId: "discord-123",
      displayIdentity: "Ada Lovelace",
    });
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ providerKey: "discord", capabilityKey: "channel" }),
    );
  });

  it("skips providers whose credentials are not configured", async () => {
    const connect = vi.fn<ConnectCapabilityFn>(async () => undefined);
    const context = baseContext({
      connect,
      accounts: [
        { providerId: "google", scopes: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE] },
        { providerId: "discord", accountId: "discord-123" },
      ],
      enabledProviders: new Set(), // nothing configured
    });

    await reconcileOwnerCapabilities(context);

    expect(connect).not.toHaveBeenCalled();
  });

  it("isolates a failing capability so other capabilities still reconcile", async () => {
    const connect = vi.fn(async (input: { capabilityKey: string }) => {
      if (input.capabilityKey === "calendar") {
        throw new Error("calendar mirror failed");
      }
      return undefined;
    });
    const onError = vi.fn();
    const context = baseContext({
      connect,
      accounts: [
        {
          providerId: "google",
          scopes: [GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE, GOOGLE_GMAIL_COMPOSE_SCOPE],
        },
      ],
      enabledProviders: new Set(["google"]),
    });

    await reconcileOwnerCapabilities(context, { onError });

    // Gmail still connected despite Calendar's failure; the failure was reported.
    expect(connect.mock.calls.map((call) => call[0].capabilityKey)).toContain("gmail");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityKey: "calendar" }),
      expect.any(Error),
    );
  });
});
