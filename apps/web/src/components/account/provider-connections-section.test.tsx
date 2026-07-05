import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProviderConnectionView } from "@/lib/integrations/provider-connection-view";
import { ProviderConnectionsSection } from "./provider-connections-section";

// The disconnect button imports a server action whose module chain reaches
// `server-only`; stub the action so this presentational test renders client-side.
vi.mock("@/app/actions/integrations", () => ({
  disconnectGoogleCalendarAction: vi.fn(),
  disconnectGoogleContactsAction: vi.fn(),
  disconnectDiscordAction: vi.fn(),
}));

const DISCORD_READY_VIEW: ProviderConnectionView = {
  providerKey: "discord",
  capabilityKey: "channel",
  label: "Discord",
  status: "ready",
  displayIdentity: null,
  revocationReason: null,
  lastErrorMessage: null,
};

const READY_VIEW: ProviderConnectionView[] = [
  {
    providerKey: "google",
    capabilityKey: "calendar",
    label: "Google Calendar",
    status: "ready",
    displayIdentity: null,
    revocationReason: null,
    lastErrorMessage: null,
  },
  {
    providerKey: "google",
    capabilityKey: "gmail",
    label: "Gmail",
    status: "ready",
    displayIdentity: null,
    revocationReason: null,
    lastErrorMessage: null,
  },
  {
    providerKey: "google",
    capabilityKey: "contacts",
    label: "Google Contacts",
    status: "ready",
    displayIdentity: null,
    revocationReason: null,
    lastErrorMessage: null,
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
            revocationReason: null,
            lastErrorMessage: null,
          },
        ]}
      />,
    );

    expect(html).toContain("Connected");
    expect(html).toContain("nick@example.com");
    expect(html).toContain("Disconnect");
    expect(html).toContain("disabled");
  });

  it("renders a live disconnect control for a connected Calendar when configured", () => {
    const html = renderToStaticMarkup(
      <ProviderConnectionsSection
        calendarConnectable
        connections={[
          {
            providerKey: "google",
            capabilityKey: "calendar",
            label: "Google Calendar",
            status: "connected",
            displayIdentity: "nick@example.com",
            revocationReason: null,
            lastErrorMessage: null,
          },
        ]}
      />,
    );

    // A real disconnect control — not the inert "(not available yet)" affordance.
    expect(html).toContain("Disconnect Google Calendar");
    expect(html).not.toContain("not available yet");
  });

  it("explains remaining Google cleanup after a disconnect that left the grant in place", () => {
    const html = renderToStaticMarkup(
      <ProviderConnectionsSection
        calendarConnectable
        connections={[
          {
            providerKey: "google",
            capabilityKey: "calendar",
            label: "Google Calendar",
            status: "revoked",
            displayIdentity: null,
            revocationReason: "user_disconnect_provider_grant_not_revoked",
            lastErrorMessage: null,
          },
        ]}
      />,
    );

    expect(html).toContain("Google Account permissions");
    expect(html).toContain("https://myaccount.google.com/permissions");
  });

  it("renders live Contacts connect and preview affordances when configured", () => {
    const readyHtml = renderToStaticMarkup(
      <ProviderConnectionsSection connections={READY_VIEW} contactsConnectable />,
    );
    expect(readyHtml).toContain("Connect Google Contacts");
    expect(readyHtml).toContain("Preview latest contacts before saving anything");

    const connectedHtml = renderToStaticMarkup(
      <ProviderConnectionsSection
        contactsConnectable
        connections={[
          {
            providerKey: "google",
            capabilityKey: "contacts",
            label: "Google Contacts",
            status: "connected",
            displayIdentity: "nick@example.com",
            revocationReason: null,
            lastErrorMessage: null,
          },
        ]}
      />,
    );
    expect(connectedHtml).toContain("Preview latest contacts");
    expect(connectedHtml).toContain("/account/contacts/import");
    expect(connectedHtml).toContain("Disconnect Google Contacts");
  });

  it("renders a live Gmail connect control when Gmail is configured, independent of Calendar", () => {
    const html = renderToStaticMarkup(
      <ProviderConnectionsSection connections={READY_VIEW} gmailConnectable />,
    );

    // The Gmail row gets a real connect control (not the inert affordance), while
    // Calendar/Contacts (no calendarConnectable) stay inert.
    expect(html).toContain("Connect Gmail");
    expect(html).not.toContain("Connect Gmail (not available yet)");
    // Copy reflects the draft-only, never-sending Gmail boundary.
    expect(html).toContain("never sending");
  });

  it("renders a live Discord connect control when Discord is configured", () => {
    const html = renderToStaticMarkup(
      <ProviderConnectionsSection connections={[DISCORD_READY_VIEW]} discordConnectable />,
    );

    // A real connect control (not the inert affordance), and copy that promises no
    // message-content read.
    expect(html).toContain("Discord");
    expect(html).toContain("Connect Discord");
    expect(html).not.toContain("Connect Discord (not available yet)");
    expect(html).toContain("no messages");
  });

  it("keeps the Discord connect affordance inert when Discord is not configured", () => {
    const html = renderToStaticMarkup(
      <ProviderConnectionsSection connections={[DISCORD_READY_VIEW]} />,
    );

    expect(html).toContain("Discord");
    expect(html).toContain("disabled");
    expect(html).not.toContain("href");
  });

  it("shows the human-readable Discord identity and a live disconnect control when connected", () => {
    const html = renderToStaticMarkup(
      <ProviderConnectionsSection
        connections={[
          {
            providerKey: "discord",
            capabilityKey: "channel",
            label: "Discord",
            status: "connected",
            // The mirrored display identity is the resolved username, not a raw id.
            displayIdentity: "nickneely",
            revocationReason: null,
            lastErrorMessage: null,
          },
        ]}
        discordConnectable
      />,
    );

    expect(html).toContain("Connected");
    expect(html).toContain("nickneely");
    expect(html).toContain("Disconnect Discord");
    expect(html).not.toContain("not available yet");
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
            revocationReason: null,
            lastErrorMessage:
              "Google Contacts must use the same linked Google account as existing Google capabilities.",
          },
        ]}
      />,
    );

    expect(html).toContain("Needs attention");
    expect(html).toContain("same linked Google account");
  });
});
