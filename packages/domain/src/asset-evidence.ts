import { z } from "zod";
import { assetChildScopeSchema } from "./asset-child-scope";
import { AssetValidationError } from "./assets";

/**
 * The small fixed Asset Evidence kind set (#196, #200): what a piece of evidence
 * *is*, so Eve and the UI can behave appropriately — a receipt can carry money
 * metadata, a link opens elsewhere, a note is retained text. Fixed on purpose:
 * evidence grounds Assets and Asset Memories, it is never a document library,
 * folder system, or general attachment bucket.
 */
export const assetEvidenceKindSchema = z.enum([
  "receipt",
  "photo",
  "manual",
  "warranty",
  "link",
  "note",
]);
export type AssetEvidenceKind = z.infer<typeof assetEvidenceKindSchema>;

/**
 * The canonical kind labels/descriptions for pickers, so every capture surface
 * (profile, review, and later Eve's plus-menu #201) names kinds the same way.
 */
export const ASSET_EVIDENCE_KIND_OPTIONS: ReadonlyArray<{
  kind: AssetEvidenceKind;
  label: string;
  description: string;
}> = [
  { kind: "receipt", label: "Receipt", description: "Proof of purchase — what you paid, when." },
  { kind: "photo", label: "Photo", description: "A label, serial plate, or the thing itself." },
  { kind: "manual", label: "Manual", description: "Instructions, spec sheets, install guides." },
  { kind: "warranty", label: "Warranty", description: "Coverage terms and expiration details." },
  { kind: "link", label: "Link", description: "A product page, support site, or account." },
  { kind: "note", label: "Note", description: "Text worth keeping exactly as captured." },
];

export function assetEvidenceLabelForKind(kind: AssetEvidenceKind): string {
  return ASSET_EVIDENCE_KIND_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
}

/**
 * Lightweight money metadata riding a receipt or renewal (#196): enough to answer
 * "what did I pay" and "when does it renew" — recall metadata only, never budgets,
 * reporting, or account balances.
 */
export const assetEvidenceMoneySchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((code) => code.toUpperCase())
      .default("USD"),
  })
  .strict();
export type AssetEvidenceMoney = z.infer<typeof assetEvidenceMoneySchema>;

/** Uploads are capped so evidence stays receipts-and-manuals, not an archive. */
export const ASSET_EVIDENCE_MAX_FILE_BYTES = 10 * 1024 * 1024;

// The short name each allowed mime type goes by in user-facing copy. This map
// IS the allowlist: the mime list, the drop-zone caption, the rejection
// message, and the file input's `accept` are all derived from it, so the copy
// can never drift from what the seam actually accepts.
const ALLOWED_FILE_TYPES: ReadonlyArray<{ mimeType: string; shortName: string }> = [
  { mimeType: "image/jpeg", shortName: "JPEG" },
  { mimeType: "image/png", shortName: "PNG" },
  { mimeType: "image/webp", shortName: "WebP" },
  { mimeType: "image/heic", shortName: "HEIC" },
  { mimeType: "image/heif", shortName: "HEIC" },
  { mimeType: "application/pdf", shortName: "PDF" },
];

/**
 * The mime types an evidence upload may carry: the images phones and scanners
 * actually produce, plus PDF for manuals/warranties/receipts. Deliberately
 * narrow — no archives, no executables, no office docs, no GIFs — the
 * foundation for future OCR, not a general file store (#196).
 */
export const ASSET_EVIDENCE_ALLOWED_MIME_TYPES: readonly string[] = ALLOWED_FILE_TYPES.map(
  (type) => type.mimeType,
);

/** "JPEG, PNG, WebP, HEIC, or PDF" — the one human name for the allowlist. */
export const ASSET_EVIDENCE_FILE_TYPES_LABEL: string = (() => {
  const names = [...new Set(ALLOWED_FILE_TYPES.map((type) => type.shortName))];
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
})();

/**
 * Guards an upload before any bytes persist: allowed type, bounded size, and a
 * real size. User-safe messages — capture surfaces render them inline.
 */
export function assertAssetEvidenceFileAccepted(file: {
  mimeType: string;
  sizeBytes: number;
}): void {
  if (!ASSET_EVIDENCE_ALLOWED_MIME_TYPES.includes(file.mimeType)) {
    throw new AssetValidationError(`Use a ${ASSET_EVIDENCE_FILE_TYPES_LABEL} file.`);
  }
  if (file.sizeBytes <= 0) {
    throw new AssetValidationError("That file looks empty — try capturing it again.");
  }
  if (file.sizeBytes > ASSET_EVIDENCE_MAX_FILE_BYTES) {
    throw new AssetValidationError(
      `Keep files under ${Math.floor(ASSET_EVIDENCE_MAX_FILE_BYTES / (1024 * 1024))} MB.`,
    );
  }
}

// ---------------------------------------------------------------------------
// File signatures
// ---------------------------------------------------------------------------

const ASCII = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Whether `bytes` carries `pattern` starting at `offset`. */
function bytesMatchAt(bytes: Uint8Array, offset: number, pattern: number[]): boolean {
  return pattern.every((value, index) => bytes[offset + index] === value);
}

// HEIC/HEIF brands seen inside the ISO-BMFF `ftyp` box phones actually write.
const HEIF_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevm", "hevs", "mif1", "msf1"];

/** Magic-byte check per allowed mime type. Small and exact — not a media parser. */
const FILE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/jpeg": (bytes) => bytesMatchAt(bytes, 0, [0xff, 0xd8, 0xff]),
  "image/png": (bytes) => bytesMatchAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": (bytes) =>
    bytesMatchAt(bytes, 0, ASCII("RIFF")) && bytesMatchAt(bytes, 8, ASCII("WEBP")),
  "image/heic": isHeifContainer,
  "image/heif": isHeifContainer,
  "application/pdf": (bytes) => bytesMatchAt(bytes, 0, ASCII("%PDF-")),
};

function isHeifContainer(bytes: Uint8Array): boolean {
  if (!bytesMatchAt(bytes, 4, ASCII("ftyp"))) {
    return false;
  }
  const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
  return HEIF_BRANDS.includes(brand);
}

/**
 * Verifies an upload's bytes actually are what its declared type claims (#200).
 * The browser-supplied mime type is caller input, and this path becomes
 * Eve-chat-reachable (#201) — so the seam checks the file signature itself
 * before bytes persist, rejecting mislabeled content fail-closed with a
 * user-safe message that never echoes the content.
 */
export function assertAssetEvidenceFileSignature(file: {
  mimeType: string;
  bytes: Uint8Array;
}): void {
  // No signature for the type (unknown mime) denies just like a mismatch.
  if (!FILE_SIGNATURES[file.mimeType]?.(file.bytes)) {
    throw new AssetValidationError(
      `That file doesn't look like a ${ASSET_EVIDENCE_FILE_TYPES_LABEL} file — try re-exporting it.`,
    );
  }
}

/** Whether a piece of evidence renders inline as an image (thumbnails, previews). */
export function isAssetEvidenceImage(mimeType: string | null): boolean {
  return mimeType?.startsWith("image/") ?? false;
}

// An evidence link is somewhere a browser can go — nothing else smuggles in.
const evidenceUrlSchema = z
  .url({ protocol: /^https?$/ })
  .trim()
  .max(2000);

/** Evidence needs substance: an uploaded file, a link, or retained text. */
function hasEvidenceSubstance(record: {
  fileName: string | null;
  url: string | null;
  capturedText: string | null;
}) {
  return record.fileName !== null || record.url !== null || record.capturedText !== null;
}

/**
 * A piece of Asset Evidence (#196, #200): grounding for an Asset and its
 * memories — a receipt, photo, manual, warranty, link, or retained text. The
 * record is the metadata; uploaded bytes live behind the store seam keyed by this
 * record's id, so lists and scope checks never touch file contents. Attachment
 * target: always an Asset (`assetId`), optionally the Asset Review Group it
 * arrived through, kept as provenance after review resolves. Visibility is
 * per-record under the child-scope ceiling — a household Asset can hold a private
 * receipt its members never see. Provenance: the grounding source record, who
 * captured it, and who last acted on it.
 */
const assetEvidenceBaseSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  ownerUserId: z.string(),
  kind: assetEvidenceKindSchema,
  label: z.string().trim().min(1).max(120),
  // Upload metadata, present together when (and only when) bytes are stored.
  fileName: z.string().trim().min(1).max(255).nullable().default(null),
  mimeType: z.string().trim().min(1).max(120).nullable().default(null),
  sizeBytes: z.number().int().positive().nullable().default(null),
  url: evidenceUrlSchema.nullable().default(null),
  // Retained text — captured verbatim now, the seam future OCR fills later (#196).
  capturedText: z.string().trim().min(1).max(5000).nullable().default(null),
  money: assetEvidenceMoneySchema.nullable().default(null),
  // Day-precise purchase/renewal anchors ("2026-03-14") — facts, not timestamps.
  purchasedOn: z.iso.date().nullable().default(null),
  renewsOn: z.iso.date().nullable().default(null),
  scope: assetChildScopeSchema.default("private"),
  householdId: z.string().nullable().default(null),
  sourceRecordId: z.string().nullable().default(null),
  // The Asset Review Group this evidence arrived through; kept after review
  // resolves as provenance, exactly as accepted Asset Memories keep theirs.
  reviewGroupId: z.string().nullable().default(null),
  createdByUserId: z.string().nullable().optional(),
  lastActorUserId: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// The evidence invariants, applied to the persisted and create shapes alike so
// the two can never drift (the same pattern as the asset memory schemas).
const EVIDENCE_INVARIANTS = [
  {
    check: hasEvidenceSubstance,
    message: "Evidence needs substance — a file, a link, or text.",
  },
  {
    check: (record: { kind: AssetEvidenceKind; url: string | null }) =>
      record.kind !== "link" || record.url !== null,
    message: "A link needs a url.",
  },
  {
    check: (record: {
      fileName: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
    }) =>
      (record.fileName === null) === (record.mimeType === null) &&
      (record.fileName === null) === (record.sizeBytes === null),
    message: "File metadata travels together — name, type, and size.",
  },
] as const;

export const assetEvidenceSchema = EVIDENCE_INVARIANTS.reduce(
  (schema, invariant) => schema.refine(invariant.check, { message: invariant.message }),
  assetEvidenceBaseSchema as z.ZodType<
    z.output<typeof assetEvidenceBaseSchema>,
    z.input<typeof assetEvidenceBaseSchema>
  >,
);

const createAssetEvidenceBaseSchema = assetEvidenceBaseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const createAssetEvidenceSchema = EVIDENCE_INVARIANTS.reduce(
  (schema, invariant) => schema.refine(invariant.check, { message: invariant.message }),
  createAssetEvidenceBaseSchema as z.ZodType<
    z.output<typeof createAssetEvidenceBaseSchema>,
    z.input<typeof createAssetEvidenceBaseSchema>
  >,
);

export type AssetEvidence = z.infer<typeof assetEvidenceSchema>;
export type CreateAssetEvidenceInput = z.input<typeof createAssetEvidenceSchema>;

/**
 * Validates a bounded update patch for persisted evidence. Defaults-free on
 * purpose — an absent key stays absent, so a re-anchor patch can never reset
 * content or metadata (the same contract as `assetUpdateSchema`). Evidence
 * content is immutable in this slice: attach it, view it, remove it — editing a
 * receipt would be rewriting evidence.
 */
export const assetEvidenceUpdateSchema = z
  .object({
    assetId: z.string(),
    scope: assetChildScopeSchema,
    householdId: z.string().nullable(),
    reviewGroupId: z.string().nullable(),
    lastActorUserId: z.string().nullable(),
  })
  .partial();

export type AssetEvidenceUpdate = z.infer<typeof assetEvidenceUpdateSchema>;
