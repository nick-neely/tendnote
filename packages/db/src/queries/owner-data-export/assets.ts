import type {
  Asset,
  AssetEvidence,
  AssetLink,
  AssetMemory,
  AssetPersonLink,
} from "@tendnote/domain";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../client";
import {
  assetEvidence,
  assetEvidenceFiles,
  assetLinks,
  assetMemories,
  assetPersonLinks,
  assets,
  people,
  sourceRecords,
} from "../../schema";
import type { OwnerDataExportGrounding } from "./actions-planning";
import { archiveEntry } from "./archive";
import { envelope, iso, jsonBytes, sensitivityRank, sortByCreatedAt, sortById } from "./shared";
import type { OwnerDataExportResource } from "./types";

/** Stored bytes are fetched through the canonical evidence table, never a URL. */
export type OwnerDataExportAssetEvidenceFile = {
  evidenceId: string;
  ownerUserId: string;
  bytes: Uint8Array;
};

/**
 * The owner-keyed Asset graph used by the archive seam. These are normalized
 * domain rows (value/money rather than their Drizzle `*_json` columns), so the
 * ZIP projection cannot accidentally carry generated vectors or cache state.
 */
export type OwnerDataExportAssetsContext = {
  assets: Asset[];
  assetMemories: AssetMemory[];
  assetEvidence: AssetEvidence[];
  assetEvidenceFiles: OwnerDataExportAssetEvidenceFile[];
  assetLinks: AssetLink[];
  assetPersonLinks: AssetPersonLink[];
  sourceRecordIds?: string[];
  personIds?: string[];
  sensitivityByRecordId?: Record<string, OwnerDataExportAssetSensitivity>;
};

export type OwnerDataExportAssetsContextLoader = (input: {
  ownerUserId: string;
}) => Promise<OwnerDataExportAssetsContext>;

export type OwnerDataExportAssetSensitivity = "normal" | "sensitive" | "restricted";

export type OwnerDataExportAssetsArchiveExtension = {
  entries: ReturnType<typeof archiveEntry>[];
  resources: OwnerDataExportResource[];
  families: string[];
  grounding: {
    assetIds: string[];
    assetMemoryIds: string[];
    assetEvidenceIds: string[];
    sensitivityByRecordId: Record<string, OwnerDataExportAssetSensitivity>;
  };
};

function directSensitivity(value: unknown): OwnerDataExportAssetSensitivity | undefined {
  if (value === "restricted" || value === "sensitive" || value === "normal") return value;
  return undefined;
}

function maxSensitivity(values: readonly (OwnerDataExportAssetSensitivity | undefined)[]) {
  return values.reduce<OwnerDataExportAssetSensitivity>(
    (highest, candidate) =>
      candidate && sensitivityRank(candidate) > sensitivityRank(highest) ? candidate : highest,
    "normal",
  );
}

function sensitivityOf(
  record: unknown,
  grounding: OwnerDataExportGrounding,
  context: OwnerDataExportAssetsContext,
) {
  const value = record as { id?: string; sourceRecordId?: string | null; sensitivity?: unknown };
  return maxSensitivity([
    directSensitivity(value.sensitivity),
    value.id ? grounding.sensitivityByRecordId?.[value.id] : undefined,
    value.id ? context.sensitivityByRecordId?.[value.id] : undefined,
    value.sourceRecordId ? grounding.sensitivityByRecordId?.[value.sourceRecordId] : undefined,
    value.sourceRecordId ? context.sensitivityByRecordId?.[value.sourceRecordId] : undefined,
  ]);
}

function assertSourceRecord(
  family: string,
  recordId: string,
  sourceRecordId: string | null,
  sourceRecordIds: ReadonlySet<string>,
) {
  if (sourceRecordId && !sourceRecordIds.has(sourceRecordId)) {
    throw new Error(
      `Owner data export ${family} ${recordId} references source record ${sourceRecordId} outside the owner export.`,
    );
  }
}

function safePathSegment(value: string) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : encodeURIComponent(value);
}

/**
 * Keep the original leaf name intelligible while removing path separators,
 * controls, traversal names, and characters that are unsafe in ZIP readers.
 */
export function sanitizeOwnerDataExportEvidenceFileName(fileName: string, fallback: string) {
  const leaf = fileName.split(/[\\/]/u).at(-1)?.trim() ?? "";
  const sanitized = [...leaf]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) return "_";
      return /^[A-Za-z0-9._-]$/u.test(character) ? character : "_";
    })
    .join("")
    .replace(/^\.+$/u, "")
    .replace(/^\.+/u, "")
    .replace(/\.{2,}/gu, ".")
    .trim();
  const candidate = sanitized || fallback;
  return candidate === "." || candidate === ".." ? fallback : candidate;
}

export function ownerDataExportEvidencePath(evidenceId: string, fileName: string) {
  const safeId = safePathSegment(evidenceId);
  const safeName = sanitizeOwnerDataExportEvidenceFileName(fileName, `${safeId}.bin`);
  return `resources/assets/evidence/${safeId}/${safeName}`;
}

function resource<T>(
  path: string,
  records: readonly T[],
  sensitivity: OwnerDataExportAssetSensitivity = "normal",
  extra: Partial<Pick<OwnerDataExportResource, "fileCount" | "fileByteCount">> = {},
) {
  const bytes = jsonBytes(envelope(records));
  return {
    entry: archiveEntry({ path, bytes }),
    resource: {
      path,
      schemaVersion: "1.0",
      contentType: "application/json" as const,
      recordCount: records.length,
      byteCount: bytes.byteLength,
      sensitivity,
      ...extra,
    },
  };
}

function assetForExport(asset: Asset, sensitivity: OwnerDataExportAssetSensitivity) {
  return {
    id: asset.id,
    ownerUserId: asset.ownerUserId,
    name: asset.name,
    kind: asset.kind,
    status: asset.status,
    scope: asset.scope,
    ownership: asset.ownership,
    householdId: asset.householdId,
    archivedAt: iso(asset.archivedAt),
    revision: asset.revision,
    createdByUserId: asset.createdByUserId ?? null,
    lastActorUserId: asset.lastActorUserId ?? null,
    createdAt: iso(asset.createdAt),
    updatedAt: iso(asset.updatedAt),
    sensitivity,
  };
}

function memoryForExport(memory: AssetMemory, sensitivity: OwnerDataExportAssetSensitivity) {
  return {
    id: memory.id,
    assetId: memory.assetId,
    ownerUserId: memory.ownerUserId,
    status: memory.status,
    label: memory.label,
    value: memory.value,
    notes: memory.notes,
    scope: memory.scope,
    ownership: memory.ownership,
    householdId: memory.householdId,
    revision: memory.revision,
    sourceRecordId: memory.sourceRecordId,
    reviewGroupId: memory.reviewGroupId,
    createdByUserId: memory.createdByUserId ?? null,
    lastActorUserId: memory.lastActorUserId ?? null,
    createdAt: iso(memory.createdAt),
    updatedAt: iso(memory.updatedAt),
    sensitivity,
  };
}

function evidenceForExport(
  evidence: AssetEvidence,
  filePath: string | null,
  safeFileName: string | null,
  sensitivity: OwnerDataExportAssetSensitivity,
) {
  return {
    id: evidence.id,
    assetId: evidence.assetId,
    ownerUserId: evidence.ownerUserId,
    kind: evidence.kind,
    label: evidence.label,
    fileName: safeFileName,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes,
    filePath,
    url: evidence.url,
    capturedText: evidence.capturedText,
    money: evidence.money,
    purchasedOn: evidence.purchasedOn,
    renewsOn: evidence.renewsOn,
    scope: evidence.scope,
    ownership: evidence.ownership,
    householdId: evidence.householdId,
    sourceRecordId: evidence.sourceRecordId,
    reviewGroupId: evidence.reviewGroupId,
    createdByUserId: evidence.createdByUserId ?? null,
    lastActorUserId: evidence.lastActorUserId ?? null,
    createdAt: iso(evidence.createdAt),
    updatedAt: iso(evidence.updatedAt),
    sensitivity,
  };
}

function assetLinkForExport(link: AssetLink, sensitivity: OwnerDataExportAssetSensitivity) {
  return {
    id: link.id,
    ownerUserId: link.ownerUserId,
    fromAssetId: link.fromAssetId,
    toAssetId: link.toAssetId,
    relation: link.relation,
    status: link.status,
    sourceRecordId: link.sourceRecordId,
    createdAt: iso(link.createdAt),
    updatedAt: iso(link.updatedAt),
    sensitivity,
  };
}

function assetPersonLinkForExport(link: AssetPersonLink) {
  return {
    id: link.id,
    ownerUserId: link.ownerUserId,
    assetId: link.assetId,
    personId: link.personId,
    relation: link.relation,
    createdAt: iso(link.createdAt),
  };
}

function hasEvidenceFileMetadata(evidence: AssetEvidence) {
  return evidence.fileName !== null || evidence.mimeType !== null || evidence.sizeBytes !== null;
}

function assertCompleteEvidenceFileMetadata(evidence: AssetEvidence) {
  if (
    hasEvidenceFileMetadata(evidence) &&
    (evidence.fileName === null || evidence.mimeType === null || evidence.sizeBytes === null)
  ) {
    throw new Error(
      `Owner data export Asset Evidence ${evidence.id} has incomplete file metadata.`,
    );
  }
}

function assertValidEvidenceFileMetadata(evidence: AssetEvidence) {
  if (evidence.fileName !== null && evidence.fileName.trim().length === 0) {
    throw new Error(`Owner data export Asset Evidence ${evidence.id} has an empty file name.`);
  }
  if (evidence.mimeType !== null && evidence.mimeType.trim().length === 0) {
    throw new Error(`Owner data export Asset Evidence ${evidence.id} has an empty mime type.`);
  }
  if (
    evidence.sizeBytes !== null &&
    (!Number.isInteger(evidence.sizeBytes) || evidence.sizeBytes <= 0)
  ) {
    throw new Error(`Owner data export Asset Evidence ${evidence.id} has an invalid file size.`);
  }
}

function assertEvidenceStoredBytes(
  evidence: AssetEvidence,
  file: OwnerDataExportAssetEvidenceFile | undefined,
) {
  const hasFileMetadata = hasEvidenceFileMetadata(evidence);
  if (hasFileMetadata && !file) {
    throw new Error(
      `Owner data export Asset Evidence ${evidence.id} has file metadata without stored bytes.`,
    );
  }
  if (!hasFileMetadata && file) {
    throw new Error(
      `Owner data export Asset Evidence ${evidence.id} has stored bytes without file metadata.`,
    );
  }
  if (file && evidence.sizeBytes !== file.bytes.byteLength) {
    throw new Error(
      `Owner data export Asset Evidence ${evidence.id} file bytes do not match metadata.`,
    );
  }
}

function validateEvidenceFile(
  evidence: AssetEvidence,
  file: OwnerDataExportAssetEvidenceFile | undefined,
) {
  assertCompleteEvidenceFileMetadata(evidence);
  assertValidEvidenceFileMetadata(evidence);
  assertEvidenceStoredBytes(evidence, file);
}

export function filterOwnerDataExportAssetsContext(
  ownerUserId: string,
  input: OwnerDataExportAssetsContext,
  grounding: OwnerDataExportGrounding,
) {
  const sourceRecordIds = new Set(grounding.sourceRecordIds ?? []);
  const personIds = new Set(grounding.personIds ?? []);
  const ownedAssets = sortById(
    input.assets.filter(
      (asset) => asset.ownerUserId === ownerUserId && asset.ownership === "member_owned",
    ),
  );
  const assetIds = new Set(ownedAssets.map((asset) => asset.id));
  const ownedMemories = sortById(
    input.assetMemories.filter(
      (memory) =>
        memory.ownerUserId === ownerUserId &&
        memory.ownership === "member_owned" &&
        assetIds.has(memory.assetId),
    ),
  );
  for (const memory of ownedMemories) {
    assertSourceRecord("Asset Memory", memory.id, memory.sourceRecordId, sourceRecordIds);
  }
  const memoryIds = new Set(ownedMemories.map((memory) => memory.id));
  const ownedEvidence = sortByCreatedAt(
    input.assetEvidence.filter(
      (evidence) =>
        evidence.ownerUserId === ownerUserId &&
        evidence.ownership === "member_owned" &&
        assetIds.has(evidence.assetId),
    ),
  );
  for (const evidence of ownedEvidence) {
    assertSourceRecord("Asset Evidence", evidence.id, evidence.sourceRecordId, sourceRecordIds);
  }
  const evidenceIds = new Set(ownedEvidence.map((evidence) => evidence.id));
  const filesByEvidenceId = new Map(
    input.assetEvidenceFiles
      .filter((file) => file.ownerUserId === ownerUserId && evidenceIds.has(file.evidenceId))
      .map((file) => [file.evidenceId, file]),
  );
  for (const evidence of ownedEvidence) {
    validateEvidenceFile(evidence, filesByEvidenceId.get(evidence.id));
  }
  const ownedAssetLinks = sortById(
    input.assetLinks.filter(
      (link) =>
        link.ownerUserId === ownerUserId &&
        assetIds.has(link.fromAssetId) &&
        assetIds.has(link.toAssetId),
    ),
  );
  for (const link of ownedAssetLinks) {
    assertSourceRecord("Asset Link", link.id, link.sourceRecordId, sourceRecordIds);
  }
  const ownedPersonLinks = sortById(
    input.assetPersonLinks.filter(
      (link) =>
        link.ownerUserId === ownerUserId &&
        assetIds.has(link.assetId) &&
        personIds.has(link.personId),
    ),
  );
  return {
    assets: ownedAssets,
    assetMemories: ownedMemories,
    assetEvidence: ownedEvidence,
    assetEvidenceFiles: filesByEvidenceId,
    assetLinks: ownedAssetLinks,
    assetPersonLinks: ownedPersonLinks,
    assetIds,
    memoryIds,
    evidenceIds,
  };
}

/** Convert the owner-filtered Asset graph into stable JSON and byte entries. */
export function ownerDataExportAssetsContextExtension(
  ownerUserId: string,
  input: OwnerDataExportAssetsContext,
  groundingInput?: OwnerDataExportGrounding,
): OwnerDataExportAssetsArchiveExtension {
  const grounding: OwnerDataExportGrounding = {
    sourceRecordIds: groundingInput?.sourceRecordIds ?? input.sourceRecordIds ?? [],
    personIds: groundingInput?.personIds ?? input.personIds ?? [],
    memoryIds: groundingInput?.memoryIds ?? [],
    followupIds: groundingInput?.followupIds ?? [],
    sensitivityByRecordId: {
      ...(input.sensitivityByRecordId ?? {}),
      ...(groundingInput?.sensitivityByRecordId ?? {}),
    },
  };
  const context = filterOwnerDataExportAssetsContext(ownerUserId, input, grounding);
  const assetSensitivity = maxSensitivity(
    context.assets.map((asset) => sensitivityOf(asset, grounding, input)),
  );
  const memorySensitivity = maxSensitivity(
    context.assetMemories.map((memory) => sensitivityOf(memory, grounding, input)),
  );
  const evidenceSensitivity = maxSensitivity(
    context.assetEvidence.map((evidence) => sensitivityOf(evidence, grounding, input)),
  );
  const assetLinkSensitivity = maxSensitivity(
    context.assetLinks.map((link) => sensitivityOf(link, grounding, input)),
  );
  const assetResource = resource(
    "resources/assets/assets-v1.json",
    context.assets.map((asset) => assetForExport(asset, sensitivityOf(asset, grounding, input))),
    assetSensitivity,
  );
  const memoryResource = resource(
    "resources/assets/asset-memories-v1.json",
    context.assetMemories.map((memory) =>
      memoryForExport(memory, sensitivityOf(memory, grounding, input)),
    ),
    memorySensitivity,
  );
  const evidenceRecords = context.assetEvidence.map((evidence) => {
    const file = context.assetEvidenceFiles.get(evidence.id);
    const safeFileName = evidence.fileName
      ? sanitizeOwnerDataExportEvidenceFileName(
          evidence.fileName,
          `${safePathSegment(evidence.id)}.bin`,
        )
      : null;
    const filePath =
      file && safeFileName ? ownerDataExportEvidencePath(evidence.id, safeFileName) : null;
    return evidenceForExport(
      evidence,
      filePath,
      safeFileName,
      sensitivityOf(evidence, grounding, input),
    );
  });
  const evidenceBytes = evidenceRecords.reduce(
    (total, evidence) =>
      total +
      (evidence.filePath
        ? (context.assetEvidenceFiles.get(evidence.id)?.bytes.byteLength ?? 0)
        : 0),
    0,
  );
  const evidenceResource = resource(
    "resources/assets/asset-evidence-v1.json",
    evidenceRecords,
    evidenceSensitivity,
    {
      fileCount: evidenceRecords.filter((evidence) => evidence.filePath !== null).length,
      fileByteCount: evidenceBytes,
    },
  );
  const linksResource = resource(
    "resources/assets/asset-links-v1.json",
    context.assetLinks.map((link) =>
      assetLinkForExport(link, sensitivityOf(link, grounding, input)),
    ),
    assetLinkSensitivity,
  );
  const peopleLinksResource = resource(
    "resources/assets/asset-person-links-v1.json",
    context.assetPersonLinks.map(assetPersonLinkForExport),
  );
  const resources: Array<{
    entry: ReturnType<typeof archiveEntry>;
    resource: OwnerDataExportResource;
  }> = [assetResource, memoryResource, evidenceResource, linksResource, peopleLinksResource];
  for (const evidence of evidenceRecords) {
    if (!evidence.filePath) continue;
    const file = context.assetEvidenceFiles.get(evidence.id);
    if (!file) continue;
    resources.push({
      entry: archiveEntry({ path: evidence.filePath, bytes: new Uint8Array(file.bytes) }),
      resource: {
        path: evidence.filePath,
        schemaVersion: "1.0",
        contentType: "application/octet-stream" as const,
        recordCount: 1,
        byteCount: file.bytes.byteLength,
        sensitivity: evidence.sensitivity,
      },
    });
  }
  return {
    entries: resources.map((item) => item.entry),
    resources: resources.map((item) => item.resource),
    families: ["Assets", "Asset Memories", "Asset Evidence", "Asset Links", "Asset Person Links"],
    grounding: {
      assetIds: [...context.assetIds].sort(),
      assetMemoryIds: [...context.memoryIds].sort(),
      assetEvidenceIds: [...context.evidenceIds].sort(),
      sensitivityByRecordId: Object.fromEntries([
        ...Object.entries(grounding.sensitivityByRecordId ?? {}),
        ...Object.entries(input.sensitivityByRecordId ?? {}),
        ...context.assetMemories.map(
          (memory) => [memory.id, sensitivityOf(memory, grounding, input)] as const,
        ),
        ...context.assetEvidence.map(
          (evidence) => [evidence.id, sensitivityOf(evidence, grounding, input)] as const,
        ),
      ]),
    },
  };
}

function loadWhenPresent<T>(ids: readonly string[], load: () => Promise<T[]>): Promise<T[]> {
  return ids.length > 0 ? load() : Promise.resolve([]);
}

/**
 * Load canonical owner-owned Asset rows and their children. This is deliberately
 * an ownership query, not a visible/shared read: an export belongs to the
 * requesting owner and never becomes a Household Workspace export.
 */
export async function loadOwnerDataExportAssetsContext(input: {
  ownerUserId: string;
}): Promise<OwnerDataExportAssetsContext> {
  const ownerUserId = input.ownerUserId;
  const db = getDb();
  const [assetRows, sourceRecordRows, personRows] = await Promise.all([
    db
      .select()
      .from(assets)
      .where(and(eq(assets.ownerUserId, ownerUserId), eq(assets.ownership, "member_owned")))
      .orderBy(asc(assets.id)),
    db
      .select({ id: sourceRecords.id, sensitivity: sourceRecords.sensitivity })
      .from(sourceRecords)
      .where(eq(sourceRecords.ownerUserId, ownerUserId))
      .orderBy(asc(sourceRecords.id)),
    db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.ownerUserId, ownerUserId))
      .orderBy(asc(people.id)),
  ]);
  const assetIds = assetRows.map((asset) => asset.id);
  const [memoryRows, evidenceRows, linkRows, personLinkRows] = await Promise.all([
    loadWhenPresent(assetIds, () =>
      db
        .select()
        .from(assetMemories)
        .where(
          and(
            eq(assetMemories.ownerUserId, ownerUserId),
            eq(assetMemories.ownership, "member_owned"),
            inArray(assetMemories.assetId, assetIds),
          ),
        )
        .orderBy(asc(assetMemories.id)),
    ),
    loadWhenPresent(assetIds, () =>
      db
        .select()
        .from(assetEvidence)
        .where(
          and(
            eq(assetEvidence.ownerUserId, ownerUserId),
            eq(assetEvidence.ownership, "member_owned"),
            inArray(assetEvidence.assetId, assetIds),
          ),
        )
        .orderBy(asc(assetEvidence.createdAt), asc(assetEvidence.id)),
    ),
    loadWhenPresent(assetIds, () =>
      db
        .select()
        .from(assetLinks)
        .where(
          and(
            eq(assetLinks.ownerUserId, ownerUserId),
            or(inArray(assetLinks.fromAssetId, assetIds), inArray(assetLinks.toAssetId, assetIds)),
          ),
        )
        .orderBy(asc(assetLinks.id)),
    ),
    loadWhenPresent(assetIds, () =>
      db
        .select()
        .from(assetPersonLinks)
        .where(
          and(
            eq(assetPersonLinks.ownerUserId, ownerUserId),
            inArray(assetPersonLinks.assetId, assetIds),
          ),
        )
        .orderBy(asc(assetPersonLinks.id)),
    ),
  ]);
  const evidenceIds = evidenceRows.map((evidence) => evidence.id);
  const fileRows = await loadWhenPresent(evidenceIds, () =>
    db
      .select()
      .from(assetEvidenceFiles)
      .where(
        and(
          eq(assetEvidenceFiles.ownerUserId, ownerUserId),
          inArray(assetEvidenceFiles.evidenceId, evidenceIds),
        ),
      )
      .orderBy(asc(assetEvidenceFiles.evidenceId)),
  );
  return {
    assets: assetRows as unknown as Asset[],
    assetMemories: memoryRows.map(({ valueJson, ...row }) => ({
      ...row,
      value: valueJson,
    })) as unknown as AssetMemory[],
    assetEvidence: evidenceRows.map(({ moneyJson, ...row }) => ({
      ...row,
      money: moneyJson,
    })) as unknown as AssetEvidence[],
    assetEvidenceFiles: fileRows.map((row) => ({
      evidenceId: row.evidenceId,
      ownerUserId: row.ownerUserId,
      bytes: row.bytes,
    })),
    assetLinks: linkRows as unknown as AssetLink[],
    assetPersonLinks: personLinkRows as unknown as AssetPersonLink[],
    sourceRecordIds: sourceRecordRows.map((record) => record.id),
    personIds: personRows.map((person) => person.id),
    sensitivityByRecordId: Object.fromEntries(
      sourceRecordRows.map((record) => [record.id, record.sensitivity]),
    ),
  };
}
