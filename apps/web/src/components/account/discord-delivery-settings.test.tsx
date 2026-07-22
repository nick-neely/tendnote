import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiscordDeliverySettings, type DiscordInstallView } from "./discord-delivery-settings";

// The row controls call server actions whose module chain reaches `server-only`;
// stub them so this presentational test renders client-side.
vi.mock("@/app/actions/integrations", () => ({
  configureDiscordTargetAction: vi.fn(),
  setDiscordDeliveryEnabledAction: vi.fn(),
}));

const ENABLED_WITH_CHANNEL: DiscordInstallView = {
  guildId: "111111111111111111",
  targetChannelId: "222222222222222222",
  enabled: true,
};

describe("DiscordDeliverySettings", () => {
  it("prompts to install when the owner has no servers yet", () => {
    const html = renderToStaticMarkup(<DiscordDeliverySettings installs={[]} />);

    expect(html).toContain("haven");
    expect(html).toContain("added Tendnote to a Discord server yet");
  });

  it("renders a delivery-on row with a pause control and the channel field for an active install", () => {
    const html = renderToStaticMarkup(
      <DiscordDeliverySettings installs={[ENABLED_WITH_CHANNEL]} />,
    );

    // Status badge reflects an enabled install with a configured channel.
    expect(html).toContain("Delivery on");
    // Pause/resume affordance is labelled for the enabled state.
    expect(html).toContain("Pause delivery for this server");
    expect(html).toContain("Pause");
    // The channel-ID form is present with its labelled input and the owner's value.
    expect(html).toContain("Delivery channel ID");
    expect(html).toContain("222222222222222222");
    expect(html).toContain("Guild 111111111111111111");
  });

  it("reads as needing a channel and offers Resume when paused without a target", () => {
    const html = renderToStaticMarkup(
      <DiscordDeliverySettings
        installs={[{ guildId: "333333333333333333", targetChannelId: null, enabled: false }]}
      />,
    );

    expect(html).toContain("Paused");
    expect(html).toContain("Resume delivery for this server");
    expect(html).toContain("Resume");
  });

  it("shows the needs-a-channel status for an enabled install without a target", () => {
    const html = renderToStaticMarkup(
      <DiscordDeliverySettings
        installs={[{ guildId: "444444444444444444", targetChannelId: null, enabled: true }]}
      />,
    );

    expect(html).toContain("Needs a channel");
  });
});
