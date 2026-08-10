import {
  ASSET_SEMANTIC_SIMILARITY_FLOOR,
  ASSET_SEMANTIC_TIER_LIMIT,
  type Asset,
  type AssetEvidence,
  type AssetMemory,
  type AssetSearchCandidate,
  type AssetSearchTrustLevel,
  buildAssetSearchTsQuery,
  describeAssetMemoryValue,
  type HouseholdMembership,
  isDurableAssetStatus,
  visibilityChoiceForScope,
  visibilityLabelForScope,
} from "@tendnote/domain";
import type { HouseholdRecordShare } from "../households/types";
import { canViewerSeeSeededHouseholdRecord } from "../households/visibility-memory";
import type {
  AssetSearchQueryInput,
  AssetSearchStore,
  SearchAssetEmbeddingsInput,
  SearchAssetRecordsInput,
} from "./types";

/** A seeded embedding row: what the shared pipeline would have written for a record. */
export type SeededAssetEmbedding = {
  ownerUserId: string;
  recordKind: "asset" | "asset_memory";
  recordId: string;
  embedding: number[];
};

export type AssetSearchSeed = {
  assets?: Asset[];
  memories?: AssetMemory[];
  evidence?: AssetEvidence[];
  embeddings?: SeededAssetEmbedding[];
  householdMemberships?: HouseholdMembership[];
  householdRecordShares?: HouseholdRecordShare[];
};

/** The seeded world each step reads, bundled so steps stay at module scope. */
type SearchWorld = {
  assets: Asset[];
  assetById: Map<string, Asset>;
  memories: AssetMemory[];
  evidence: AssetEvidence[];
  embeddings: SeededAssetEmbedding[];
  householdMemberships: HouseholdMembership[];
  householdRecordShares: HouseholdRecordShare[];
};

type ChildKind = "asset" | "asset_memory" | "asset_evidence";

/** A scoped record, as the shared visibility predicate wants it. */
type ScopedRecord = {
  id: string;
  ownerUserId: string;
  householdId?: string | null;
  scope: Asset["scope"];
};

/**
 * The in-memory Asset Search store: the behavioral twin of the drizzle store, and the
 * seam every Asset Search test runs against. It re-implements the same policy in TS —
 * the visibility predicate, the review gate, the archive gate, the lexical OR-match,
 * the structured value comparisons, and the cosine ranking — so search behavior can be
 * pinned without a database. The drizzle store is guarded to the same rules by the SQL
 * it is built from; the two must move together.
 *
 * A thin factory over module-scope steps (the repo's fallow factory pattern).
 */
export function createInMemoryAssetSearchStore(seed: AssetSearchSeed = {}): AssetSearchStore {
  const assets = seed.assets ?? [];
  const world: SearchWorld = {
    assets,
    assetById: new Map(assets.map((asset) => [asset.id, asset])),
    memories: seed.memories ?? [],
    evidence: seed.evidence ?? [],
    embeddings: seed.embeddings ?? [],
    householdMemberships: seed.householdMemberships ?? [],
    householdRecordShares: seed.householdRecordShares ?? [],
  };

  return {
    searchAssetRecords: (input) => searchAssetRecords(world, input),
    searchAssetEmbeddings: (input) => searchAssetEmbeddings(world, input),
  };
}

function canSee(
  world: SearchWorld,
  record: ScopedRecord,
  recordKind: ChildKind,
  callerUserId: string,
): boolean {
  return canViewerSeeSeededHouseholdRecord({
    callerUserId,
    record,
    recordKind,
    householdMemberships: world.householdMemberships,
    householdRecordShares: world.householdRecordShares,
  });
}

/**
 * The anchor gate, applied to every record of every kind: a result surfaces only if its
 * Asset is durable, visible to the caller, and passes the caller's archive and kind
 * filters. A child record can never out-live or out-reach the thing it hangs off.
 */
function visibleAnchor(
  world: SearchWorld,
  assetId: string,
  query: AssetSearchQueryInput,
): Asset | null {
  const asset = world.assetById.get(assetId);
  if (!asset || !isDurableAssetStatus(asset.status)) {
    return null;
  }

  return matchesAssetFilters(asset, query) && canSee(world, asset, "asset", query.ownerUserId)
    ? asset
    : null;
}

/** The caller's own narrowing — archive state, one asset, a kind — never a security gate. */
function matchesAssetFilters(asset: Asset, query: AssetSearchQueryInput): boolean {
  if (!query.includeArchived && asset.status === "archived") {
    return false;
  }
  if (query.assetId && asset.id !== query.assetId) {
    return false;
  }

  return !query.assetKinds || query.assetKinds.includes(asset.kind);
}

function wantsKind(query: AssetSearchQueryInput, kind: ChildKind): boolean {
  return !query.recordKinds || query.recordKinds.includes(kind);
}

/**
 * Whether an Asset Memory may participate at all: dismissed husks never, and a
 * `suggested` proposal only for its own owner in explicit review context. The
 * embedding index is held to the same rule — it is not a back door around the gate.
 */
function memoryIsRetrievable(memory: AssetMemory, query: AssetSearchQueryInput): boolean {
  if (memory.status === "dismissed") {
    return false;
  }
  if (memory.status === "suggested") {
    return query.includeReviewGated && memory.ownerUserId === query.ownerUserId;
  }

  return true;
}

/** The memory fields every tier reports the same way, so the two tiers cannot drift. */
function memoryFacts(memory: AssetMemory, asset: Asset) {
  const valueText = describeAssetMemoryValue(memory.value);
  const trustLevel: AssetSearchTrustLevel =
    memory.status === "suggested" ? "suggested_asset_fact" : "asset_fact";

  return {
    ...baseCandidate(asset, {
      recordKind: "asset_memory",
      recordId: memory.id,
      label: memory.label,
      snippet: valueText ? `${memory.label}: ${valueText}` : memory.label,
      trustLevel,
      scope: memory.scope,
      value: memory.value,
      citations: [
        { kind: "asset_memory", id: memory.id },
        { kind: "asset", id: asset.id },
        ...(memory.sourceRecordId
          ? ([{ kind: "source_record", id: memory.sourceRecordId }] as const)
          : []),
      ],
    }),
    valueText,
  };
}

function baseCandidate(
  asset: Asset,
  fields: {
    recordKind: ChildKind;
    recordId: string;
    label: string;
    snippet: string;
    trustLevel: AssetSearchTrustLevel;
    scope: Asset["scope"];
    value?: AssetMemory["value"];
    citations: AssetSearchCandidate["citations"];
  },
) {
  return {
    recordKind: fields.recordKind,
    recordId: fields.recordId,
    assetId: asset.id,
    assetName: asset.name,
    assetKind: asset.kind,
    assetStatus: asset.status,
    // The anchor's ownership, for every record kind — mirroring the SQL, which reads
    // `a.ownership` in each branch rather than the child row's (ADR 0214).
    ownership: asset.ownership,
    label: fields.label,
    snippet: fields.snippet,
    value: fields.value ?? null,
    trustLevel: fields.trustLevel,
    visibilityChoice: visibilityChoiceForScope(fields.scope),
    visibilityLabel: visibilityLabelForScope(fields.scope),
    citations: fields.citations,
  };
}

/** Mirrors the SQL `to_tsquery` OR-match: any term present in the text matches. */
function makeLexicalScore(terms: string[]) {
  return (text: string): number => {
    const haystack = text.toLowerCase();
    const hits = terms.filter((term) => haystack.includes(term)).length;

    // Normalized to (0,1) exactly as the SQL normalizes ts_rank_cd.
    return hits === 0 ? 0 : hits / (hits + 1);
  };
}

function searchAssetRecords(
  world: SearchWorld,
  input: SearchAssetRecordsInput,
): Promise<AssetSearchCandidate[]> {
  const score = makeLexicalScore(buildAssetSearchTsQuery(input.plan)?.split(" | ") ?? []);

  return Promise.resolve([
    ...assetCandidates(world, input, score),
    ...memoryCandidates(world, input, score),
    ...evidenceCandidates(world, input, score),
  ]);
}

function assetCandidates(
  world: SearchWorld,
  input: SearchAssetRecordsInput,
  score: (text: string) => number,
): AssetSearchCandidate[] {
  if (!wantsKind(input, "asset")) {
    return [];
  }

  return world.assets.flatMap((asset) => {
    const anchor = visibleAnchor(world, asset.id, input);
    const sourceScore = anchor ? score(asset.name) : 0;
    if (!anchor || sourceScore === 0) {
      return [];
    }

    return [
      {
        ...baseCandidate(anchor, {
          recordKind: "asset",
          recordId: anchor.id,
          label: anchor.name,
          snippet: anchor.name,
          trustLevel: "asset_anchor",
          scope: anchor.scope,
          citations: [{ kind: "asset", id: anchor.id }],
        }),
        matchedFields: ["name"],
        matchKind: "exact" as const,
        sourceScore,
      },
    ];
  });
}

function memoryCandidates(
  world: SearchWorld,
  input: SearchAssetRecordsInput,
  score: (text: string) => number,
): AssetSearchCandidate[] {
  if (!wantsKind(input, "asset_memory")) {
    return [];
  }

  return world.memories.flatMap((memory) => memoryCandidatesFor(world, input, score, memory));
}

/** Every way one memory can match: lexically, structurally, or both. */
function memoryCandidatesFor(
  world: SearchWorld,
  input: SearchAssetRecordsInput,
  score: (text: string) => number,
  memory: AssetMemory,
): AssetSearchCandidate[] {
  const asset = visibleAnchor(world, memory.assetId, input);
  if (
    !asset ||
    !memoryIsRetrievable(memory, input) ||
    !canSee(world, memory, "asset_memory", input.ownerUserId)
  ) {
    return [];
  }

  const { valueText, ...base } = memoryFacts(memory, asset);
  const lexical = lexicalMemoryCandidate(base, memory, valueText, score);
  const structured = matchesStructuredValue(memory, input.plan)
    ? // A typed value either matches exactly or it does not — there is no partial
      // credit for an exact fact.
      { ...base, matchedFields: ["value"], matchKind: "structured" as const, sourceScore: 1 }
    : null;

  return [lexical, structured].filter(
    (candidate): candidate is AssetSearchCandidate => candidate !== null,
  );
}

type MemoryBase = Omit<AssetSearchCandidate, "matchedFields" | "matchKind" | "sourceScore">;

/** The lexical arm: which of the memory's text fields the query's terms actually hit. */
function lexicalMemoryCandidate(
  base: MemoryBase,
  memory: AssetMemory,
  valueText: string,
  score: (text: string) => number,
): AssetSearchCandidate | null {
  const matchedFields = [
    score(memory.label) > 0 ? "label" : null,
    memory.notes && score(memory.notes) > 0 ? "notes" : null,
    valueText && score(valueText) > 0 ? "value" : null,
  ].filter((field): field is string => field !== null);

  if (matchedFields.length === 0) {
    return null;
  }

  return {
    ...base,
    matchedFields,
    matchKind: "exact",
    sourceScore: score([memory.label, memory.notes ?? "", valueText].join(" ")),
  };
}

function evidenceCandidates(
  world: SearchWorld,
  input: SearchAssetRecordsInput,
  score: (text: string) => number,
): AssetSearchCandidate[] {
  if (!wantsKind(input, "asset_evidence")) {
    return [];
  }

  return world.evidence.flatMap((item) => {
    const asset = visibleAnchor(world, item.assetId, input);
    if (!asset || !canSee(world, item, "asset_evidence", input.ownerUserId)) {
      return [];
    }

    const base = baseCandidate(asset, {
      recordKind: "asset_evidence",
      recordId: item.id,
      label: item.label,
      snippet: item.capturedText ?? item.label,
      trustLevel: "asset_evidence",
      scope: item.scope,
      citations: [
        { kind: "asset_evidence", id: item.id },
        { kind: "asset", id: asset.id },
      ],
    });

    const candidates: AssetSearchCandidate[] = [];
    const sourceScore = score([item.label, item.fileName ?? "", item.capturedText ?? ""].join(" "));

    if (sourceScore > 0) {
      candidates.push({ ...base, matchedFields: ["label"], matchKind: "exact", sourceScore });
    }

    if (matchesStructuredEvidence(item, input.plan)) {
      candidates.push({
        ...base,
        matchedFields: ["value"],
        matchKind: "structured",
        sourceScore: 1,
      });
    }

    return candidates;
  });
}

function searchAssetEmbeddings(
  world: SearchWorld,
  input: SearchAssetEmbeddingsInput,
): Promise<AssetSearchCandidate[]> {
  const candidates = world.embeddings.flatMap((embedding) => {
    // Note what is *not* checked here: that the caller owns the vector. An embedding
    // belongs to whoever wrote the record, so a household asset owned by another member is
    // embedded under their id and must still be semantically findable by everyone who can
    // see it. Access is decided by the anchor and per-record visibility gates the two
    // builders below apply — never by vector ownership (mirrors the relationship store).
    const similarity = cosineSimilarity(embedding.embedding, input.queryEmbedding);
    // The relevance floor, mirroring the SQL: a hit below it is ambient similarity, not
    // a claim — and "Related" on a record that isn't is worse than no row at all.
    if (similarity < ASSET_SEMANTIC_SIMILARITY_FLOOR) {
      return [];
    }

    const candidate =
      embedding.recordKind === "asset"
        ? embeddedAsset(world, embedding.recordId, input)
        : embeddedMemory(world, embedding.recordId, input);

    return candidate ? [{ ...candidate, sourceScore: similarity }] : [];
  });

  // The tier cap, mirroring the SQL's `limit`: a broad meaning-shaped query may not bury
  // the exact and structured hits it is fused with.
  return Promise.resolve(
    candidates
      .sort((left, right) => right.sourceScore - left.sourceScore)
      .slice(0, ASSET_SEMANTIC_TIER_LIMIT),
  );
}

type EmbeddedCandidate = Omit<AssetSearchCandidate, "sourceScore">;

function embeddedAsset(
  world: SearchWorld,
  assetId: string,
  input: AssetSearchQueryInput,
): EmbeddedCandidate | null {
  const asset = wantsKind(input, "asset") ? visibleAnchor(world, assetId, input) : null;
  if (!asset) {
    return null;
  }

  return {
    ...baseCandidate(asset, {
      recordKind: "asset",
      recordId: asset.id,
      label: asset.name,
      snippet: asset.name,
      trustLevel: "asset_anchor",
      scope: asset.scope,
      citations: [{ kind: "asset", id: asset.id }],
    }),
    matchedFields: ["name"],
    matchKind: "semantic",
  };
}

function embeddedMemory(
  world: SearchWorld,
  memoryId: string,
  input: AssetSearchQueryInput,
): EmbeddedCandidate | null {
  if (!wantsKind(input, "asset_memory")) {
    return null;
  }

  const memory = world.memories.find((candidate) => candidate.id === memoryId);
  if (!memory) {
    return null;
  }

  const asset = visibleAnchor(world, memory.assetId, input);
  // The same review and visibility gates as the lexical tier — an embedding is not a
  // back door around scope.
  if (
    !asset ||
    !memoryIsRetrievable(memory, input) ||
    !canSee(world, memory, "asset_memory", input.ownerUserId)
  ) {
    return null;
  }

  const { valueText: _valueText, ...base } = memoryFacts(memory, asset);

  return { ...base, matchedFields: ["semantic"], matchKind: "semantic" };
}

/**
 * A typed Asset Memory value matches the query's structured intent when the exact value
 * the user typed is the value the memory holds — the same amount, the same calendar
 * date, or the same identifier text. Exactness is the whole point: this is the tier that
 * answers "what filter does the fridge need?" with the real part number.
 */
function matchesStructuredValue(
  memory: Pick<AssetMemory, "value">,
  plan: SearchAssetRecordsInput["plan"],
): boolean {
  const { value } = memory;
  if (!value) {
    return false;
  }

  if (value.type === "amount" && plan.amount) {
    return value.amount === plan.amount.amount && value.currency === plan.amount.currency;
  }

  if (value.type === "date" && plan.date) {
    return value.date === plan.date;
  }

  if (value.type === "text" && plan.identifiers.length > 0) {
    const text = value.text.toUpperCase();

    return plan.identifiers.some((identifier) => text.includes(identifier));
  }

  return false;
}

/** The evidence equivalent: a receipt amount, a purchase date, or a renewal date. */
function matchesStructuredEvidence(
  item: Pick<AssetEvidence, "money" | "purchasedOn" | "renewsOn">,
  plan: SearchAssetRecordsInput["plan"],
): boolean {
  const amountMatches = Boolean(
    plan.amount &&
      item.money &&
      item.money.amount === plan.amount.amount &&
      item.money.currency === plan.amount.currency,
  );

  return (
    amountMatches ||
    Boolean(plan.date && (item.purchasedOn === plan.date || item.renewsOn === plan.date))
  );
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }

  const magnitude = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);

  return magnitude === 0 ? 0 : dot / magnitude;
}
