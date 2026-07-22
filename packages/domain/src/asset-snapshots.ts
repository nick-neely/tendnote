import { createHash } from "node:crypto";
import { z } from "zod";
import type { AssetEvidenceKind } from "./asset-evidence";
import type { AssetLinkRelation, AssetPersonRelation } from "./asset-links";
import type { AssetMemory, AssetMemoryValue } from "./asset-memories";
import { type Asset, assetLabelForKind } from "./assets";
import { describeRecurrence } from "./general-actions";

/**
 * Record-level supporting references for an Asset Snapshot. A snapshot is a
 * *rebuildable cache*, never a source of truth (#196 decisions; ADR 0009 applied to
 * Assets): the prose is generated, but these ids are not — they name the exact rows
 * the prose was built from, so any consumer (the Asset Profile, Eve) can fetch the
 * real records before making a specific claim.
 */
export const assetSnapshotSupportingReferencesSchema = z.object({
  assetIds: z.array(z.string()).default([]),
  assetMemoryIds: z.array(z.string()).default([]),
  assetEvidenceIds: z.array(z.string()).default([]),
  relatedAssetLinkIds: z.array(z.string()).default([]),
  assetPersonLinkIds: z.array(z.string()).default([]),
  generalActionIds: z.array(z.string()).default([]),
});
export type AssetSnapshotSupportingReferences = z.infer<
  typeof assetSnapshotSupportingReferencesSchema
>;

/**
 * One current row per owner/asset. Carries the generated prose plus the operational
 * cache metadata that makes it safely rebuildable: what produced it, a fingerprint
 * of the inputs it was built from (staleness), when, and — if generation failed —
 * why. `failureReason` is what lets a stale snapshot degrade gracefully instead of
 * silently lying.
 */
export const assetSnapshotSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  assetId: z.string(),
  summary: z.string(),
  supportingReferences: assetSnapshotSupportingReferencesSchema,
  generatorVersion: z.string().min(1),
  inputFingerprint: z.string().min(1),
  generatedAt: z.date(),
  failureReason: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createAssetSnapshotSchema = assetSnapshotSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AssetSnapshot = z.infer<typeof assetSnapshotSchema>;
export type CreateAssetSnapshotInput = z.infer<typeof createAssetSnapshotSchema>;

/** Compact evidence reference — kind and label only; evidence content is never asserted. */
export type AssetSnapshotEvidence = {
  id: string;
  kind: AssetEvidenceKind;
  label: string;
  updatedAt: Date;
};

export type AssetSnapshotRelatedAsset = {
  linkId: string;
  relation: AssetLinkRelation;
  assetId: string;
  assetName: string;
};

export type AssetSnapshotPersonLink = {
  linkId: string;
  relation: AssetPersonRelation;
  personId: string;
  personName: string;
};

/** Compact action reference. Lifecycle stays owned by the General Action, not the cache. */
export type AssetSnapshotAction = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  updatedAt: Date;
};

/**
 * The trusted input pack handed to a snapshot generator. The *builder* owns loading
 * these, applying visibility filtering, and owner scoping; a generator only turns
 * the pack into prose. Every record here has already passed the caller's visibility
 * gate — a snapshot can never widen what someone may see.
 */
export type AssetSnapshotInputPack = {
  asset: Asset;
  /** Reviewed (`active`) memories only. Suggested proposals are not facts. */
  memories: AssetMemory[];
  evidence: AssetSnapshotEvidence[];
  relatedAssets: AssetSnapshotRelatedAsset[];
  personLinks: AssetSnapshotPersonLink[];
  actions: AssetSnapshotAction[];
};

/** A generator's only output: prose plus the version tag identifying what produced it. */
export type AssetSnapshotProse = {
  summary: string;
  generatorVersion: string;
};

export const DETERMINISTIC_ASSET_SNAPSHOT_GENERATOR_VERSION = "asset-deterministic-v1";

/**
 * The canonical text form of a typed Asset Memory value. One projection used by the
 * snapshot prose, the embedded text, and the search snippet, so an exact fact reads
 * identically wherever it surfaces. Amounts keep two decimals and their currency —
 * recall metadata, never a formatted financial figure.
 */
export function describeAssetMemoryValue(value: AssetMemoryValue | null): string {
  if (!value) {
    return "";
  }

  switch (value.type) {
    case "text":
      return value.text;
    case "date":
      return value.date;
    // A cadence reads in the Routine's own words (#203), so an interval memory says the
    // same thing here, in its embedded text, and on the reminder it proposes.
    case "interval":
      return describeRecurrence({ interval: value.interval, unit: value.unit });
    case "amount":
      return `${value.amount.toFixed(2)} ${value.currency}`;
  }
}

/** A memory rendered as one line: "Filter size: RPWFE (replace every 6 months)". */
function describeMemory(memory: Pick<AssetMemory, "label" | "value" | "notes">): string {
  const value = describeAssetMemoryValue(memory.value);
  const head = value ? `${memory.label}: ${value}` : memory.label;

  return memory.notes ? `${head} (${memory.notes})` : head;
}

/** Only reviewed memories are facts. A suggested proposal never reaches the prose. */
function reviewedMemories(pack: AssetSnapshotInputPack): AssetMemory[] {
  return pack.memories.filter((memory) => memory.status === "active");
}

/**
 * Record-level supporting references, derived straight from the visibility-filtered
 * input pack. The *builder* owns this — never the generator, and never the model —
 * so a snapshot's grounding cannot drift with its prose (#196 user story 49).
 */
export function collectAssetSnapshotReferences(
  pack: AssetSnapshotInputPack,
): AssetSnapshotSupportingReferences {
  return {
    assetIds: [pack.asset.id],
    assetMemoryIds: pack.memories.map((memory) => memory.id),
    assetEvidenceIds: pack.evidence.map((evidence) => evidence.id),
    relatedAssetLinkIds: pack.relatedAssets.map((related) => related.linkId),
    assetPersonLinkIds: pack.personLinks.map((link) => link.linkId),
    generalActionIds: pack.actions.map((action) => action.id),
  };
}

/**
 * Deterministic, record-driven fingerprint of a snapshot's inputs. Staleness is
 * detected by recomputing this and comparing — no dirty flags, no invalidation
 * events, nothing to forget to fire. Record *content* is hashed alongside ids and
 * timestamps, so correcting a filter size flips the snapshot stale even when
 * `updatedAt` cannot move within timestamp resolution.
 */
export function computeAssetSnapshotFingerprint(pack: AssetSnapshotInputPack): string {
  const { asset } = pack;
  const parts: string[] = [
    "asset",
    asset.id,
    asset.name,
    asset.kind,
    asset.status,
    asset.scope,
    asset.updatedAt.toISOString(),
  ];

  parts.push("memories");
  for (const memory of [...pack.memories].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(
      memory.id,
      memory.status,
      memory.label,
      describeAssetMemoryValue(memory.value),
      memory.notes ?? "",
      memory.updatedAt.toISOString(),
    );
  }

  parts.push("evidence");
  for (const evidence of [...pack.evidence].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(evidence.id, evidence.kind, evidence.label, evidence.updatedAt.toISOString());
  }

  parts.push("related");
  for (const related of [...pack.relatedAssets].sort((a, b) => a.linkId.localeCompare(b.linkId))) {
    parts.push(related.linkId, related.relation, related.assetId, related.assetName);
  }

  parts.push("people");
  for (const link of [...pack.personLinks].sort((a, b) => a.linkId.localeCompare(b.linkId))) {
    parts.push(link.linkId, link.relation, link.personId, link.personName);
  }

  // Status and due date are included so completing, rescheduling, or reopening a
  // linked action flips the snapshot stale — the card must never claim work is open
  // after it was done.
  parts.push("actions");
  for (const action of [...pack.actions].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(action.id, action.title, action.status, action.dueAt ?? "");
  }

  // Joined on NUL — written as an escape, so this source file stays plain text and
  // diffable. A separator that cannot occur inside a field is what keeps the fingerprint
  // unambiguous: joining on a space would let an asset named "Kitchen refrigerator" hash
  // identically to two adjacent fields "Kitchen" and "refrigerator", so a real edit could
  // land on the same fingerprint and never rebuild the snapshot.
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

/**
 * Deterministic snapshot generator: the default, the test generator, and the
 * fallback when an LLM generation fails. It keeps the trust model intact — reviewed
 * memories read as confirmed facts with their exact values, evidence is named as
 * grounding "on file" rather than asserted, and suggested memories are excluded
 * outright. Length follows the facts; a bare anchor gets one sentence, not a story.
 */
export function generateDeterministicAssetSnapshot(
  pack: AssetSnapshotInputPack,
): AssetSnapshotProse {
  const { asset } = pack;
  const kindLabel = assetLabelForKind(asset.kind).toLowerCase();
  const lines: string[] = [
    asset.status === "archived"
      ? `${asset.name} is an archived ${kindLabel} you no longer track actively.`
      : `${asset.name} is ${/^[aeiou]/.test(kindLabel) ? "an" : "a"} ${kindLabel} you track.`,
  ];

  const facts = reviewedMemories(pack);
  if (facts.length > 0) {
    lines.push(`Confirmed: ${facts.map(describeMemory).join(". ")}.`);
  }

  if (pack.evidence.length > 0) {
    lines.push(
      `Evidence on file: ${pack.evidence.map((evidence) => `${evidence.label} (${evidence.kind})`).join(", ")}.`,
    );
  }

  if (pack.relatedAssets.length > 0) {
    lines.push(
      `Related: ${pack.relatedAssets.map((related) => `${related.relation.replace(/_/g, " ")} ${related.assetName}`).join(", ")}.`,
    );
  }

  if (pack.personLinks.length > 0) {
    lines.push(
      `People: ${pack.personLinks.map((link) => `${link.personName} ${link.relation.replace(/_/g, " ")}`).join(", ")}.`,
    );
  }

  if (pack.actions.length > 0) {
    lines.push(
      `Work: ${pack.actions.map((action) => `${action.title} (${action.status}${action.dueAt ? `, due ${action.dueAt}` : ""})`).join(", ")}.`,
    );
  }

  return {
    summary: lines.join("\n"),
    generatorVersion: DETERMINISTIC_ASSET_SNAPSHOT_GENERATOR_VERSION,
  };
}

/**
 * The prompt handed to an LLM snapshot generator. Pure and testable so the generator
 * contract can be verified without a model.
 *
 * Suggested-memory content is withheld from the prompt entirely, matching the
 * deterministic generator's hard exclusion: keeping a tentative extraction out of
 * the model's context is a guarantee, not a rule we trust the model to follow. The
 * same anti-confabulation framing the relationship snapshot prompt uses applies —
 * an asset card that invents a filter size is worse than no card at all.
 */
export function buildAssetSnapshotPrompt(pack: AssetSnapshotInputPack): string {
  const { asset } = pack;
  const facts = reviewedMemories(pack);
  const sections: string[] = [
    "Write a brief, grounded summary of one thing the user owns, to help them recall it.",
    "Use only the facts provided below.",
    "",
    "Grounding rules (these override tone and length):",
    "- Report only what the facts state. Never invent, guess, or round a model number,",
    "  serial, filter size, price, or date. An invented exact value is worse than none.",
    "- Evidence is grounding material, not a claim: say a receipt or manual is on file,",
    "  never assert what it says.",
    "- Do not editorialize about the purchase, the brand, or how well it is maintained.",
    "",
    "Length (match the amount of information — never pad):",
    "- One or two facts: one or two plain sentences.",
    "- Never exceed two short paragraphs.",
    "",
    "Formatting rules:",
    "- Plain prose only. No Markdown: no headings, bold/italic, lists, links, or code.",
    "- Do not restate the asset's name or kind as a title line — those are shown above.",
    "",
    `Asset: ${asset.name} (${assetLabelForKind(asset.kind)}${asset.status === "archived" ? ", archived" : ""}).`,
    "",
    "Confirmed facts (reviewed asset memories):",
    facts.length > 0 ? facts.map((memory) => `- ${describeMemory(memory)}`).join("\n") : "- none",
    "",
    "Evidence on file (name it; never assert its contents):",
    pack.evidence.length > 0
      ? pack.evidence.map((evidence) => `- ${evidence.label} (${evidence.kind})`).join("\n")
      : "- none",
    "",
    "Related assets:",
    pack.relatedAssets.length > 0
      ? pack.relatedAssets
          .map((related) => `- ${related.relation.replace(/_/g, " ")} ${related.assetName}`)
          .join("\n")
      : "- none",
    "",
    "Related work (General Actions):",
    pack.actions.length > 0
      ? pack.actions
          .map(
            (action) =>
              `- ${action.title} (${action.status}${action.dueAt ? `, due ${action.dueAt}` : ""})`,
          )
          .join("\n")
      : "- none",
  ];

  return sections.join("\n");
}
