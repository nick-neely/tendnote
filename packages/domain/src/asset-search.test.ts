import { describe, expect, it } from "vitest";
import {
  type AssetSearchCandidate,
  assetSearchResultSchema,
  buildAssetSearchTsQuery,
  mergeAssetSearchResults,
  parseAssetSearchQuery,
  searchAssetsSchema,
} from "./asset-search";

describe("buildAssetSearchTsQuery", () => {
  it("searches on the alias-folded token, so a typed 'fridge' reaches a stored 'Refrigerator'", () => {
    expect(buildAssetSearchTsQuery(parseAssetSearchQuery("kitchen fridge"))).toBe(
      "kitchen | refrigerator",
    );
  });

  it("ORs terms so a partly-matching name is still found", () => {
    // "kitchen" may not appear on the asset at all; the refrigerator must still match.
    expect(buildAssetSearchTsQuery(parseAssetSearchQuery("fridge"))).toBe("refrigerator");
  });

  it("includes identifiers so a serial or model is lexically findable", () => {
    expect(buildAssetSearchTsQuery(parseAssetSearchQuery("RPWFE"))).toBe("rpwfe");
  });

  it("reduces terms to bare alphanumerics — a tsquery can never be malformed or injected", () => {
    const plan = parseAssetSearchQuery("filter & model | 'x' :* !bad");

    expect(() => buildAssetSearchTsQuery(plan)).not.toThrow();
    expect(buildAssetSearchTsQuery(plan)).not.toMatch(/[&:!'*]/);
  });

  it("is null when the query carries no searchable term, only a structured value", () => {
    expect(buildAssetSearchTsQuery(parseAssetSearchQuery("$450"))).toBeNull();
  });
});

describe("parseAssetSearchQuery", () => {
  it("folds the query to normalized, alias-canonical tokens so 'kitchen fridge' can reach a Refrigerator", () => {
    const plan = parseAssetSearchQuery("the kitchen fridge");

    // Stopwords dropped, alias folded (fridge -> refrigerator), sorted for determinism.
    expect(plan.tokens).toEqual(["kitchen", "refrigerator"]);
  });

  it("folds plurals so 'filters' finds a 'filter'", () => {
    expect(parseAssetSearchQuery("water filters").tokens).toEqual(["filter", "water"]);
  });

  it("reads a currency amount as a structured value, not as free text", () => {
    expect(parseAssetSearchQuery("receipt for $1,299.99").amount).toEqual({
      amount: 1299.99,
      currency: "USD",
    });
    expect(parseAssetSearchQuery("paid 450 EUR").amount).toEqual({ amount: 450, currency: "EUR" });
  });

  it("does not read a bare number as an amount — a currency marker is required", () => {
    expect(parseAssetSearchQuery("filter 4396508").amount).toBeNull();
  });

  it("reads an ISO calendar date as a structured value", () => {
    expect(parseAssetSearchQuery("warranty until 2026-03-14").date).toBe("2026-03-14");
  });

  it("extracts identifier-like tokens (serials, model names, filter sizes) for exact structured matching", () => {
    const plan = parseAssetSearchQuery("does it take an RPWFE or model 4396508?");

    expect(plan.identifiers).toEqual(["4396508", "RPWFE"]);
  });

  it("never mistakes an amount or a date for an identifier", () => {
    const plan = parseAssetSearchQuery("$450 on 2026-03-14");

    expect(plan.identifiers).toEqual([]);
    expect(plan.amount).toEqual({ amount: 450, currency: "USD" });
    expect(plan.date).toBe("2026-03-14");
  });

  it("keeps the raw text for lexical search", () => {
    expect(parseAssetSearchQuery("  fridge filter  ").text).toBe("fridge filter");
  });
});

function candidate(overrides: Partial<AssetSearchCandidate> = {}): AssetSearchCandidate {
  return {
    recordKind: "asset_memory",
    recordId: "memory-1",
    assetId: "asset-1",
    assetName: "Refrigerator",
    assetKind: "appliance",
    assetStatus: "active",
    ownership: "member_owned",
    label: "Filter size",
    snippet: "RPWFE",
    matchedFields: ["label"],
    matchKind: "exact",
    sourceScore: 0.5,
    value: { type: "text", text: "RPWFE" },
    trustLevel: "asset_fact",
    visibilityChoice: "only_me",
    visibilityLabel: "Only me",
    citations: [
      { kind: "asset_memory", id: "memory-1" },
      { kind: "asset", id: "asset-1" },
    ],
    ...overrides,
  };
}

describe("mergeAssetSearchResults", () => {
  it("collapses the same record found by several signals into one result carrying every match kind", () => {
    const results = mergeAssetSearchResults({
      candidates: [
        candidate({ matchKind: "exact", sourceScore: 0.4, matchedFields: ["label"] }),
        candidate({ matchKind: "semantic", sourceScore: 0.9, matchedFields: ["notes"] }),
        candidate({ matchKind: "structured", sourceScore: 1, matchedFields: ["value"] }),
      ],
      limit: 10,
    });

    expect(results).toHaveLength(1);
    // Match kinds are reported in precision order so a reader sees the strongest signal first.
    expect(results[0]?.matchKinds).toEqual(["structured", "exact", "semantic"]);
    // Every field that matched survives the merge, deduped and stable.
    expect(results[0]?.matchedFields).toEqual(["label", "notes", "value"]);
  });

  it("drops a meaning-only record hanging off a thing the query never found", () => {
    // The noise the semantic tier used to produce: type "boiler", and the fridge's
    // purchase price arrives stamped "Related" because a vector called them alike. A
    // threshold cannot fix this — similarity is a continuum — so the gate asks the
    // question a threshold cannot: related to *what*?
    const results = mergeAssetSearchResults({
      candidates: [
        candidate({ recordKind: "asset", recordId: "asset-boiler", assetId: "asset-boiler" }),
        candidate({
          recordId: "memory-fridge-price",
          assetId: "asset-fridge",
          matchKind: "semantic",
          sourceScore: 0.9,
        }),
      ],
      limit: 10,
    });

    expect(results.map((result) => result.recordId)).toEqual(["asset-boiler"]);
  });

  it("keeps a meaning-only record whose asset the query DID find — the flagship fuzzy case", () => {
    // "anything for the kitchen fridge" finds the refrigerator by name; the filter size
    // matches no word typed and rides in on meaning alone. That is what the semantic
    // tier is *for*, and gating it away would be the wrong cure for the noise above.
    const results = mergeAssetSearchResults({
      candidates: [
        candidate({ recordKind: "asset", recordId: "asset-fridge", assetId: "asset-fridge" }),
        candidate({
          recordId: "memory-filter",
          assetId: "asset-fridge",
          matchKind: "semantic",
          sourceScore: 0.9,
        }),
      ],
      limit: 10,
    });

    expect(results.map((result) => result.recordId)).toContain("memory-filter");
  });

  it("opens the semantic tier fully when nothing matched exactly — meaning is all there is", () => {
    const results = mergeAssetSearchResults({
      candidates: [
        candidate({
          recordId: "memory-a",
          assetId: "asset-a",
          matchKind: "semantic",
          sourceScore: 0.8,
        }),
        candidate({
          recordId: "memory-b",
          assetId: "asset-b",
          matchKind: "semantic",
          sourceScore: 0.7,
        }),
      ],
      limit: 10,
    });

    expect(results.map((result) => result.recordId)).toEqual(["memory-a", "memory-b"]);
  });

  it("never gates a record a second signal corroborated", () => {
    // Found exactly *and* semantically on an asset nothing else matched: it is not
    // meaning-only, so the gate must not touch it — corroboration is the fusion's point.
    const results = mergeAssetSearchResults({
      candidates: [
        candidate({ recordKind: "asset", recordId: "asset-boiler", assetId: "asset-boiler" }),
        candidate({
          recordId: "memory-corroborated",
          assetId: "asset-other",
          matchKind: "exact",
          sourceScore: 0.4,
        }),
        candidate({
          recordId: "memory-corroborated",
          assetId: "asset-other",
          matchKind: "semantic",
          sourceScore: 0.9,
        }),
      ],
      limit: 10,
    });

    const corroborated = results.find((result) => result.recordId === "memory-corroborated");
    expect(corroborated?.matchKinds).toEqual(["exact", "semantic"]);
  });

  it("ranks a precise structured hit above a merely semantic one", () => {
    const results = mergeAssetSearchResults({
      candidates: [
        // A perfect semantic score still loses to an exact typed-value match.
        candidate({ recordId: "memory-fuzzy", matchKind: "semantic", sourceScore: 1 }),
        candidate({ recordId: "memory-exact", matchKind: "structured", sourceScore: 0.7 }),
      ],
      limit: 10,
    });

    expect(results.map((result) => result.recordId)).toEqual(["memory-exact", "memory-fuzzy"]);
  });

  it("rewards a record that several independent signals agree on", () => {
    const [agreed] = mergeAssetSearchResults({
      candidates: [
        candidate({ recordId: "agreed", matchKind: "exact", sourceScore: 0.5 }),
        candidate({ recordId: "agreed", matchKind: "semantic", sourceScore: 0.5 }),
      ],
      limit: 10,
    });
    const [lone] = mergeAssetSearchResults({
      candidates: [candidate({ recordId: "lone", matchKind: "exact", sourceScore: 0.5 })],
      limit: 10,
    });

    expect(agreed?.score).toBeGreaterThan(lone?.score ?? 0);
  });

  it("orders deterministically when scores tie, so the same query always reads the same", () => {
    const results = mergeAssetSearchResults({
      candidates: [
        candidate({ recordId: "b", label: "Zebra", sourceScore: 0.5 }),
        candidate({ recordId: "a", label: "Alpha", sourceScore: 0.5 }),
        candidate({ recordId: "c", label: "Alpha", sourceScore: 0.5 }),
      ],
      limit: 10,
    });

    // Score desc, then label asc, then recordId asc.
    expect(results.map((result) => result.recordId)).toEqual(["a", "c", "b"]);
  });

  it("applies the caller's limit after merging, never before", () => {
    const results = mergeAssetSearchResults({
      candidates: [
        candidate({ recordId: "a", sourceScore: 0.9 }),
        candidate({ recordId: "b", sourceScore: 0.8 }),
        candidate({ recordId: "c", sourceScore: 0.7 }),
      ],
      limit: 2,
    });

    expect(results.map((result) => result.recordId)).toEqual(["a", "b"]);
  });

  it("keeps records of different kinds that happen to share an id distinct", () => {
    const results = mergeAssetSearchResults({
      candidates: [
        candidate({ recordKind: "asset", recordId: "shared-id" }),
        candidate({ recordKind: "asset_memory", recordId: "shared-id" }),
      ],
      limit: 10,
    });

    expect(results).toHaveLength(2);
  });

  it("produces results that satisfy the typed contract", () => {
    const [result] = mergeAssetSearchResults({ candidates: [candidate()], limit: 10 });

    expect(() => assetSearchResultSchema.parse(result)).not.toThrow();
  });
});

describe("assetSearchResultSchema", () => {
  it("requires at least one citation — a search result is always traceable to a record", () => {
    const [result] = mergeAssetSearchResults({ candidates: [candidate()], limit: 10 });

    expect(() => assetSearchResultSchema.parse({ ...result, citations: [] })).toThrow();
  });
});

describe("searchAssetsSchema", () => {
  it("defaults to a grounded, review-free, active-only search", () => {
    const parsed = searchAssetsSchema.parse({ query: "fridge filter" });

    expect(parsed.limit).toBe(8);
    expect(parsed.includeArchived).toBe(false);
    expect(parsed.includeReviewGated).toBe(false);
  });

  it("rejects an empty query", () => {
    expect(() => searchAssetsSchema.parse({ query: "   " })).toThrow();
  });
});
