import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProviderConnectionView } from "@/lib/integrations/provider-connection-view";
import { ProviderConnectionsSection } from "./provider-connections-section";

const READY_VIEW: ProviderConnectionView[] = [
  {
    providerKey: "google",
    capabilityKey: "calendar",
    label: "Google Calendar",
    status: "ready",
    displayIdentity: null,
  },
  {
    providerKey: "google",
    capabilityKey: "gmail",
    label: "Gmail",
    status: "ready",
    displayIdentity: null,
  },
  {
    providerKey: "google",
    capabilityKey: "contacts",
    label: "Google Contacts",
    status: "ready",
    displayIdentity: null,
  },
];

describe("ProviderConnectionsSection", () => {
  it("renders Calendar, Gmail, and Contacts as distinct capabilities with a not-connected status", () => {
    const html = renderToStaticMarkup(<ProviderConnectionsSection connections={READY_VIEW} />);

    expect(html).toContain("Google Calendar");
    expect(html).toContain("Gmail");
    expect(html).toContain("Google Contacts");
    // Default status is honest about not being connected.
    expect(html).toContain("Not connected");
  });

  it("renders the connect affordance as disabled and inert (no live OAuth)", () => {
    const html = renderToStaticMarkup(<ProviderConnectionsSection connections={READY_VIEW} />);

    expect(html).toContain("Connect");
    expect(html).toContain("disabled");
    // No OAuth scope request or external provider link is implied.
    expect(html).not.toContain("href");
    expect(html.toLowerCase()).not.toContain("accounts.google.com");
    expect(html.toLowerCase()).not.toContain("oauth");
    // Copy makes clear no Google data is being read.
    expect(html).toContain("isn");
    expect(html).toContain("reading");
  });

  it("shows connected identity and a disconnect affordance for a connected capability", () => {
    const html = renderToStaticMarkup(
      <ProviderConnectionsSection
        connections={[
          {
            providerKey: "google",
            capabilityKey: "calendar",
            label: "Google Calendar",
            status: "connected",
            displayIdentity: "nick@example.com",
          },
        ]}
      />,
    );

    expect(html).toContain("Connected");
    expect(html).toContain("nick@example.com");
    expect(html).toContain("Disconnect");
    expect(html).toContain("disabled");
  });

  it("surfaces an error status as visible state without color alone", () => {
    const html = renderToStaticMarkup(
      <ProviderConnectionsSection
        connections={[
          {
            providerKey: "google",
            capabilityKey: "gmail",
            label: "Gmail",
            status: "error",
            displayIdentity: null,
          },
        ]}
      />,
    );

    expect(html).toContain("Needs attention");
  });
});
