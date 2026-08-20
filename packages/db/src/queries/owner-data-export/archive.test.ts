import { describe, expect, it } from "vitest";
import {
  buildOwnerDataExportArchive,
  OWNER_DATA_EXPORT_MAX_ENTRY_BYTES,
  OWNER_DATA_EXPORT_MAX_TOTAL_ENTRY_BYTES,
  OWNER_DATA_EXPORT_RETENTION_MS,
  OWNER_DATA_EXPORT_SCHEMA_VERSION,
} from "./archive";

const account = {
  id: "owner-1",
  name: "Owner Example",
  email: "owner@example.com",
  accessStatus: "granted" as const,
  accessSource: "self_hosted_bootstrap",
  grantedAt: new Date("2026-08-19T12:00:00.000Z"),
};

function decodeArchiveNames(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  return ["manifest.json", "resources/account/profile-v1.json", "inventory.txt"].filter((name) =>
    text.includes(name),
  );
}

describe("owner data export archive foundation", () => {
  it("builds a versioned ZIP manifest, profile resource, and human inventory", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const result = buildOwnerDataExportArchive({
      account,
      now,
      expiresAt: new Date(now.getTime() + OWNER_DATA_EXPORT_RETENTION_MS),
    });

    expect(result.bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(result.manifest).toMatchObject({
      format: "tendnote-owner-data-export",
      schemaVersion: OWNER_DATA_EXPORT_SCHEMA_VERSION,
      accountId: "owner-1",
      includedFamilies: ["account profile"],
    });
    expect(result.manifest.exclusions.join(" ")).toContain("credentials");
    expect(decodeArchiveNames(result.bytes)).toEqual([
      "manifest.json",
      "resources/account/profile-v1.json",
      "inventory.txt",
    ]);

    const archiveText = new TextDecoder().decode(result.bytes);
    expect(archiveText).toContain("owner@example.com");
    expect(archiveText).toContain("Reconnect provider integrations");
  });

  it("allows later resource families to append versioned entries without changing the foundation", () => {
    const result = buildOwnerDataExportArchive({
      account,
      now: new Date("2026-08-19T12:00:00.000Z"),
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
      additionalResources: [
        {
          path: "resources/people/people-v1.json",
          schemaVersion: "1.0",
          contentType: "application/json",
          recordCount: 2,
        },
      ],
      additionalFamilies: ["People"],
      additionalEntries: [
        {
          path: "resources/people/people-v1.json",
          bytes: new TextEncoder().encode("[]"),
        },
      ],
    });

    expect(result.manifest.resources).toHaveLength(2);
    expect(result.manifest.includedFamilies).toContain("People");
    expect(new TextDecoder().decode(result.bytes)).toContain("people-v1.json");
  });

  it.each([
    "/absolute.json",
    "../escape.json",
    "resources/people/../../escape.json",
    "C:/absolute.json",
    "resources\\people\\people.json",
  ])("rejects unsafe extension ZIP path %s", (path) => {
    expect(() =>
      buildOwnerDataExportArchive({
        account,
        now: new Date("2026-08-19T12:00:00.000Z"),
        expiresAt: new Date("2026-08-20T12:00:00.000Z"),
        additionalEntries: [{ path, bytes: new Uint8Array() }],
      }),
    ).toThrow("canonical relative ZIP path");
  });

  it("rejects duplicate entry and resource paths", () => {
    const base = {
      account,
      now: new Date("2026-08-19T12:00:00.000Z"),
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
    };
    expect(() =>
      buildOwnerDataExportArchive({
        ...base,
        additionalEntries: [{ path: "manifest.json", bytes: new Uint8Array() }],
      }),
    ).toThrow("duplicates manifest.json");
    expect(() =>
      buildOwnerDataExportArchive({
        ...base,
        additionalResources: [
          {
            path: "resources/account/profile-v1.json",
            schemaVersion: "1.0",
            contentType: "application/json",
          },
        ],
      }),
    ).toThrow("duplicates resources/account/profile-v1.json");
  });

  it("rejects per-entry and aggregate extension byte excess before ZIP materialization", () => {
    const base = {
      account,
      now: new Date("2026-08-19T12:00:00.000Z"),
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
    };
    const maxEntry = new Uint8Array(OWNER_DATA_EXPORT_MAX_ENTRY_BYTES);
    expect(() =>
      buildOwnerDataExportArchive({
        ...base,
        additionalEntries: [
          {
            path: "resources/oversized.bin",
            bytes: new Uint8Array(OWNER_DATA_EXPORT_MAX_ENTRY_BYTES + 1),
          },
        ],
      }),
    ).toThrow("exceeds the byte limit");

    const aggregateEntries = Array.from(
      { length: OWNER_DATA_EXPORT_MAX_TOTAL_ENTRY_BYTES / OWNER_DATA_EXPORT_MAX_ENTRY_BYTES },
      (_, index) => ({ path: `resources/chunk-${index}.bin`, bytes: maxEntry }),
    );
    expect(() =>
      buildOwnerDataExportArchive({
        ...base,
        additionalEntries: [
          ...aggregateEntries,
          { path: "resources/one-byte-too-many.bin", bytes: new Uint8Array([1]) },
        ],
      }),
    ).toThrow("total byte limit");
  });
});
