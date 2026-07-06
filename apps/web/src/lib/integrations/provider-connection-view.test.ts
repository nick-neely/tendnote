import { DEFAULT_PROVIDER_CAPABILITIES, type ProviderConnection } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { buildProviderConnectionView } from "./provider-connection-view";

function connection(overrides: Partial<ProviderConnection>): ProviderConnection {
  const now = new Date("2026-06-25T12:00:00.000Z");
  return {
    id: "pc-1",
    ownerUserId: "user-1",
    providerKey: "google",
    capabilityKey: "calendar",
    status: "ready",
    displayIdentity: null,
    authorizedScopes: null,
    connectedAt: null,
    revokedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    revocationReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildProviderConnectionView", () => {
  it("renders the default capabilities in catalog order, defaulting to ready", () => {
    const view = buildProviderConnectionView([]);

    expect(view.map((row) => row.label)).toEqual([
      "Google Calendar",
      "Gmail",
      "Google Contacts",
      "Discord",
    ]);
    expect(view.every((row) => row.status === "ready")).toBe(true);
    expect(view.every((row) => row.displayIdentity === null)).toBe(true);
    expect(view.every((row) => row.lastErrorMessage === null)).toBe(true);
  });

  it("overlays persisted status and display identity onto the matching capability", () => {
    const view = buildProviderConnectionView([
      connection({
        capabilityKey: "gmail",
        status: "connected",
        displayIdentity: "nick@example.com",
      }),
    ]);

    const gmail = view.find((row) => row.capabilityKey === "gmail");
    expect(gmail).toMatchObject({ status: "connected", displayIdentity: "nick@example.com" });
    // Untouched capabilities keep the ready default.
    expect(view.find((row) => row.capabilityKey === "calendar")?.status).toBe("ready");
  });

  it("ignores connections for capabilities not in the catalog", () => {
    const view = buildProviderConnectionView([
      connection({ capabilityKey: "drive", status: "connected" }),
    ]);

    expect(view).toHaveLength(DEFAULT_PROVIDER_CAPABILITIES.length);
    expect(view.some((row) => row.capabilityKey === "drive")).toBe(false);
  });

  it("carries non-secret error detail for visible blocked states", () => {
    const view = buildProviderConnectionView([
      connection({
        capabilityKey: "contacts",
        status: "error",
        lastErrorMessage: "Google Contacts must use the same linked Google account.",
      }),
    ]);

    expect(view.find((row) => row.capabilityKey === "contacts")).toMatchObject({
      status: "error",
      lastErrorMessage: "Google Contacts must use the same linked Google account.",
    });
  });
});
