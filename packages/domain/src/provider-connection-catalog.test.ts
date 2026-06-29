import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_CAPABILITIES,
  isDefaultProviderCapability,
} from "./provider-connection-catalog";
import { providerCapabilityKey } from "./provider-connections";

describe("default provider capabilities", () => {
  it("covers Google Calendar, Gmail, and Google Contacts as distinct capabilities", () => {
    expect(DEFAULT_PROVIDER_CAPABILITIES.map((c) => c.label)).toEqual([
      "Google Calendar",
      "Gmail",
      "Google Contacts",
    ]);
    const keys = DEFAULT_PROVIDER_CAPABILITIES.map(providerCapabilityKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("google:calendar");
  });

  it("recognises default capabilities and rejects unknown ones", () => {
    expect(isDefaultProviderCapability({ providerKey: "google", capabilityKey: "gmail" })).toBe(
      true,
    );
    expect(isDefaultProviderCapability({ providerKey: "google", capabilityKey: "drive" })).toBe(
      false,
    );
  });
});
