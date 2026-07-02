import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_CAPABILITIES,
  GOOGLE_CONTACTS_READONLY_SCOPE,
  hasContactsReadScope,
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
    expect(keys).toContain("google:contacts");
  });

  it("recognises default capabilities and rejects unknown ones", () => {
    expect(isDefaultProviderCapability({ providerKey: "google", capabilityKey: "gmail" })).toBe(
      true,
    );
    expect(isDefaultProviderCapability({ providerKey: "google", capabilityKey: "drive" })).toBe(
      false,
    );
  });

  it("defines a narrow personal Contacts read scope and detects it", () => {
    expect(GOOGLE_CONTACTS_READONLY_SCOPE).toBe(
      "https://www.googleapis.com/auth/contacts.readonly",
    );
    expect(hasContactsReadScope(["email", GOOGLE_CONTACTS_READONLY_SCOPE])).toBe(true);
    expect(hasContactsReadScope(["https://www.googleapis.com/auth/directory.readonly"])).toBe(
      false,
    );
  });
});
