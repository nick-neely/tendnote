import type {
  OwnerDataExportAccount,
  OwnerDataExportManifest,
  OwnerDataExportResource,
} from "./types";

export const OWNER_DATA_EXPORT_SCHEMA_VERSION = "1.0" as const;
export const OWNER_DATA_EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const OWNER_DATA_EXPORT_MAX_ARCHIVE_ENTRIES = 1024;
export const OWNER_DATA_EXPORT_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const OWNER_DATA_EXPORT_MAX_TOTAL_ENTRY_BYTES = 256 * 1024 * 1024;
export const OWNER_DATA_EXPORT_MAX_PATH_BYTES = 1024;

const FOUNDATION_ENTRY_PATHS = [
  "manifest.json",
  "resources/account/profile-v1.json",
  "inventory.txt",
] as const;
const FOUNDATION_RESOURCE_PATHS = ["resources/account/profile-v1.json"] as const;

const INCLUDED_FAMILIES = ["account profile"] as const;
const EXCLUSIONS = [
  "Household Workspace records, rosters, and records owned by another member",
  "records merely shared to the requester",
  "Household-native records and generated Orientation Context (which is not source truth)",
  "credentials, sessions, OAuth tokens, and provider connection state",
  "raw provider payloads, calendar caches, generated snapshots, embeddings, queues, deliveries, and internal audit rows",
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

function validateArchivePath(path: string, label: string) {
  const pathBytes = new TextEncoder().encode(path).byteLength;
  const segments = path.split("/");
  if (
    !path ||
    pathBytes > OWNER_DATA_EXPORT_MAX_PATH_BYTES ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a canonical relative ZIP path.`);
  }
}

function validateUniquePaths(paths: string[], reserved: readonly string[], label: string) {
  const seen = new Set(reserved);
  for (const path of paths) {
    validateArchivePath(path, label);
    if (seen.has(path)) throw new Error(`${label} duplicates ${path}.`);
    seen.add(path);
  }
}

function validateExtensionInputs(input: {
  entries: ArchiveEntry[];
  resources: OwnerDataExportResource[];
}) {
  if (
    FOUNDATION_ENTRY_PATHS.length + input.entries.length >
    OWNER_DATA_EXPORT_MAX_ARCHIVE_ENTRIES
  ) {
    throw new Error("Owner data export archive has too many entries.");
  }
  if (
    FOUNDATION_RESOURCE_PATHS.length + input.resources.length >
    OWNER_DATA_EXPORT_MAX_ARCHIVE_ENTRIES
  ) {
    throw new Error("Owner data export manifest has too many resources.");
  }

  validateUniquePaths(
    input.entries.map((entry) => entry.path),
    FOUNDATION_ENTRY_PATHS,
    "Owner data export entry path",
  );
  validateUniquePaths(
    input.resources.map((resource) => resource.path),
    FOUNDATION_RESOURCE_PATHS,
    "Owner data export resource path",
  );

  let totalBytes = 0;
  for (const entry of input.entries) {
    if (entry.bytes.byteLength > OWNER_DATA_EXPORT_MAX_ENTRY_BYTES) {
      throw new Error(`Owner data export entry ${entry.path} exceeds the byte limit.`);
    }
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > OWNER_DATA_EXPORT_MAX_TOTAL_ENTRY_BYTES) {
      throw new Error("Owner data export extension entries exceed the total byte limit.");
    }
  }
}

function validateMaterializedEntries(
  entries: ArchiveEntry[],
  resources: OwnerDataExportResource[],
) {
  if (entries.length > OWNER_DATA_EXPORT_MAX_ARCHIVE_ENTRIES) {
    throw new Error("Owner data export archive has too many entries.");
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    validateArchivePath(entry.path, "Owner data export entry path");
    if (seen.has(entry.path))
      throw new Error(`Owner data export entry path duplicates ${entry.path}.`);
    seen.add(entry.path);
    if (entry.bytes.byteLength > OWNER_DATA_EXPORT_MAX_ENTRY_BYTES) {
      throw new Error(`Owner data export entry ${entry.path} exceeds the byte limit.`);
    }
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > OWNER_DATA_EXPORT_MAX_TOTAL_ENTRY_BYTES) {
      throw new Error("Owner data export archive exceeds the total byte limit.");
    }
  }

  for (const resource of resources) {
    if (!seen.has(resource.path)) {
      throw new Error(`Owner data export resource ${resource.path} has no archive entry.`);
    }
  }
}

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
  const resources = manifest.resources.map((resource) => {
    const count =
      resource.recordCount === undefined
        ? ""
        : `, ${resource.recordCount} record${resource.recordCount === 1 ? "" : "s"}`;
    const sensitivity = resource.sensitivity ? `, sensitivity ${resource.sensitivity}` : "";
    const files =
      resource.fileCount === undefined
        ? ""
        : `, ${resource.fileCount} file${resource.fileCount === 1 ? "" : "s"}, ${resource.fileByteCount ?? 0} evidence bytes`;
    return `- ${resource.path}${count}${files}${sensitivity}`;
  });
  return [
    "Tendnote Owner Data Export",
    `Schema: ${manifest.schemaVersion}`,
    `Generated: ${manifest.generatedAt}`,
    `Expires: ${manifest.expiresAt}`,
    "",
    `Account: ${account.name} <${account.email}>`,
    `Included families: ${manifest.includedFamilies.join(", ")}`,
    "Included resources:",
    ...resources,
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
  const additionalEntries = input.additionalEntries ?? [];
  const additionalResources = input.additionalResources ?? [];
  validateExtensionInputs({ entries: additionalEntries, resources: additionalResources });

  const resources: OwnerDataExportResource[] = [
    {
      path: "resources/account/profile-v1.json",
      schemaVersion: OWNER_DATA_EXPORT_SCHEMA_VERSION,
      contentType: "application/json",
      recordCount: 1,
      sensitivity: "normal",
    },
    ...additionalResources,
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
      "Restricted records are labelled in their own resource metadata.",
      "Reconnect provider integrations after moving this data to another deployment.",
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
    ...additionalEntries,
  ];
  validateMaterializedEntries(entries, resources);
  return { bytes: zip(entries, input.now), manifest };
}

export function archiveEntry(input: {
  path: string;
  bytes: Uint8Array;
  resource?: OwnerDataExportResource;
}): ArchiveEntry {
  return input;
}
