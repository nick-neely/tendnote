import type {
  OwnerDataExportAccount,
  OwnerDataExportManifest,
  OwnerDataExportResource,
} from "./types";

export const OWNER_DATA_EXPORT_SCHEMA_VERSION = "1.0" as const;
export const OWNER_DATA_EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

const INCLUDED_FAMILIES = ["account profile"] as const;
const EXCLUSIONS = [
  "Household Workspace records, rosters, and records owned by another member",
  "records merely shared to the requester",
  "credentials, sessions, OAuth tokens, and provider connection state",
  "calendar caches, generated snapshots, embeddings, queues, deliveries, and internal audit rows",
] as const;

export type OwnerDataExportArchive = {
  bytes: Uint8Array;
  manifest: OwnerDataExportManifest;
};

type ArchiveEntry = {
  path: string;
  bytes: Uint8Array;
  resource?: OwnerDataExportResource;
};

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function jsonBytes(value: unknown) {
  return utf8(`${JSON.stringify(value, null, 2)}\n`);
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCSeconds() >> 1) | (date.getUTCMinutes() << 5) | (date.getUTCHours() << 11),
    date: date.getUTCDate() | ((date.getUTCMonth() + 1) << 5) | ((year - 1980) << 9),
  };
}

// ZIP's CRC-32 is small enough to keep here and avoids adding an archive
// dependency to the database package. Entries are intentionally stored (rather
// than compressed) so the first export remains deterministic and portable.
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function zip(entries: ArchiveEntry[], now: Date) {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(now);

  for (const entry of entries) {
    const name = utf8(entry.path);
    const checksum = crc32(entry.bytes);
    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(checksum),
      u32(entry.bytes.length),
      u32(entry.bytes.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    localChunks.push(localHeader, entry.bytes);

    centralChunks.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(time),
        u16(date),
        u32(checksum),
        u32(entry.bytes.length),
        u32(entry.bytes.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += localHeader.length + entry.bytes.length;
  }

  const centralDirectory = concat(centralChunks);
  return concat([
    concat(localChunks),
    centralDirectory,
    concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(entries.length),
      u16(entries.length),
      u32(centralDirectory.length),
      u32(offset),
      u16(0),
    ]),
  ]);
}

function inventory(account: OwnerDataExportAccount, manifest: OwnerDataExportManifest) {
  return [
    "Tendnote Owner Data Export",
    `Schema: ${manifest.schemaVersion}`,
    `Generated: ${manifest.generatedAt}`,
    `Expires: ${manifest.expiresAt}`,
    "",
    `Account: ${account.name} <${account.email}>`,
    "Included: account profile (one record)",
    "",
    "This archive is an explicitly requested owner export. It is not a backup",
    "of credentials or operational state. Reconnect provider integrations after",
    "moving this data to another deployment.",
    "",
    "Material exclusions:",
    ...manifest.exclusions.map((exclusion) => `- ${exclusion}`),
    "",
  ].join("\n");
}

/**
 * Build the first portable archive foundation. Later resource families append
 * versioned entries to this same manifest/ZIP contract; no caller needs to
 * know how the ZIP container is assembled.
 */
export function buildOwnerDataExportArchive(input: {
  account: OwnerDataExportAccount;
  now: Date;
  expiresAt: Date;
  additionalEntries?: ArchiveEntry[];
  additionalResources?: OwnerDataExportResource[];
  additionalFamilies?: string[];
}): OwnerDataExportArchive {
  const resources: OwnerDataExportResource[] = [
    {
      path: "resources/account/profile-v1.json",
      schemaVersion: OWNER_DATA_EXPORT_SCHEMA_VERSION,
      contentType: "application/json",
      recordCount: 1,
      sensitivity: "normal",
    },
    ...(input.additionalResources ?? []),
  ];
  const manifest: OwnerDataExportManifest = {
    format: "tendnote-owner-data-export",
    schemaVersion: OWNER_DATA_EXPORT_SCHEMA_VERSION,
    generatedAt: input.now.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    accountId: input.account.id,
    resources,
    includedFamilies: [...INCLUDED_FAMILIES, ...(input.additionalFamilies ?? [])],
    exclusions: [...EXCLUSIONS],
    notes: [
      "Import is not included in this release.",
      "A future Household Workspace export requires separate authorization.",
      "Restricted records in later resources are labelled in their own metadata.",
    ],
  };
  const entries: ArchiveEntry[] = [
    { path: "manifest.json", bytes: jsonBytes(manifest) },
    {
      path: "resources/account/profile-v1.json",
      bytes: jsonBytes({
        schemaVersion: OWNER_DATA_EXPORT_SCHEMA_VERSION,
        id: input.account.id,
        name: input.account.name,
        email: input.account.email,
        access: {
          status: input.account.accessStatus,
          source: input.account.accessSource,
          grantedAt: input.account.grantedAt?.toISOString() ?? null,
        },
      }),
    },
    { path: "inventory.txt", bytes: utf8(inventory(input.account, manifest)) },
    ...(input.additionalEntries ?? []),
  ];
  return { bytes: zip(entries, input.now), manifest };
}

export function archiveEntry(input: {
  path: string;
  bytes: Uint8Array;
  resource?: OwnerDataExportResource;
}): ArchiveEntry {
  return input;
}
