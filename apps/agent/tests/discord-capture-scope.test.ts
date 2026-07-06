import { describe, expect, it } from "vitest";
import { resolveDiscordCaptureScope } from "../agent/lib/discord-capture-scope";

describe("Discord capture scope policy", () => {
  it("gates an empty Discord context through as a private capture", () => {
    // A `private` decision carries no scope payload: it is a go-ahead to the
    // already-private DB write path, not the enforcement of privacy itself.
    expect(resolveDiscordCaptureScope()).toEqual({ type: "private" });
  });

  it("stays a private gate even when a guild and channel are present", () => {
    // Guild/channel membership is the exact signal that must NOT be read as
    // household or shared authority (ADR-0132, ADR-0139).
    expect(resolveDiscordCaptureScope({ guildId: "guild-1", channelId: "channel-1" })).toEqual({
      type: "private",
    });
  });

  it("treats an explicit private request as a private capture", () => {
    expect(resolveDiscordCaptureScope({ requestedScope: "private" })).toEqual({ type: "private" });
  });

  it("rejects an explicit shared request rather than implying it from Discord", () => {
    expect(resolveDiscordCaptureScope({ requestedScope: "shared" })).toEqual({
      type: "rejected",
      reason: "household_scope_not_supported",
    });
  });

  it("rejects an explicit household request even inside a shared guild channel", () => {
    expect(
      resolveDiscordCaptureScope({
        guildId: "guild-1",
        channelId: "channel-1",
        requestedScope: "household",
      }),
    ).toEqual({ type: "rejected", reason: "household_scope_not_supported" });
  });
});
