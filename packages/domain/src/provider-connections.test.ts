import { describe, expect, it } from "vitest";
import {
  capabilityKeySchema,
  providerConnectionSchema,
  providerConnectionStatusSchema,
  providerKeySchema,
} from "./provider-connections";

describe("provider/capability key validation", () => {
  it("accepts generic lowercase identifiers", () => {
    expect(providerKeySchema.parse("google")).toBe("google");
    expect(capabilityKeySchema.parse("calendar")).toBe("calendar");
    expect(providerKeySchema.parse("future_provider")).toBe("future_provider");
  });

  it("rejects empty, uppercase, or punctuation-laden keys", () => {
    expect(() => providerKeySchema.parse("")).toThrow();
    expect(() => providerKeySchema.parse("Google")).toThrow();
    expect(() => capabilityKeySchema.parse("g-mail")).toThrow();
    expect(() => capabilityKeySchema.parse("1calendar")).toThrow();
  });
});

describe("provider connection status vocabulary", () => {
  it("defines the Phase 2B lifecycle statuses", () => {
    expect(providerConnectionStatusSchema.options).toEqual([
      "ready",
      "pending",
      "connected",
      "revoked",
      "error",
      "unavailable",
    ]);
  });

  it("rejects unknown statuses", () => {
    expect(() => providerConnectionStatusSchema.parse("authorized")).toThrow();
  });
});

describe("provider connection shape is non-secret", () => {
  it("parses a valid non-secret connection", () => {
    const now = new Date();
    const parsed = providerConnectionSchema.parse({
      id: "pc-1",
      ownerUserId: "user-1",
      providerKey: "google",
      capabilityKey: "calendar",
      status: "ready",
      displayIdentity: null,
      authorizedScopes: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.status).toBe("ready");
  });

  it("excludes any token, cursor, or raw-payload fields from the persisted shape", () => {
    const fields = Object.keys(providerConnectionSchema.shape);
    const forbidden = [
      "accessToken",
      "refreshToken",
      "token",
      "tokenBlob",
      "encryptedToken",
      "syncCursor",
      "cursor",
      "watermark",
      "rawPayload",
      "calendarData",
      "gmailData",
      "contactsData",
    ];
    for (const name of forbidden) {
      expect(fields).not.toContain(name);
    }
  });
});
