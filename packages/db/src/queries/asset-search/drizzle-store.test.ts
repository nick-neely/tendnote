import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASSET_SEMANTIC_SIMILARITY_FLOOR,
  ASSET_SEMANTIC_TIER_LIMIT,
  parseAssetSearchQuery,
} from "@tendnote/domain";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { buildAssetSearchEmbeddingsQuery, buildAssetSearchRecordsQuery } from "./drizzle-store";
import type { SearchAssetEmbeddingsInput, SearchAssetRecordsInput } from "./types";

/**
 * The drizzle Asset Search store, pinned at the SQL it actually emits (#204).
 *
 * This file exists because the behavioral suite (`search.test.ts`) runs against the
 * in-memory twin, which cannot fail the way a real query fails. The store's structured
 * tier binds user-typed identifiers, and binding a JS array as one parameter — rather
 * than a list of scalars — is a Postgres *runtime* error ("malformed array literal") that
 * every in-memory test would happily pass. The headline query of the whole feature is a
 * model number, so that path gets rendered here, parameters and all, exactly as the
 * driver would send it.
 *
 * The remaining assertions are source guards, matching this package's convention for
 * drizzle stores with no live-DB harness (see `assets/drizzle-evidence-store.test.ts`):
 * they pin the production behaviors — visibility, the review gate — the twin cannot
 * exercise on this store's behalf.
 */
const dialect = new PgDialect();
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

function recordsInput(
  query: string,
  overrides: Partial<SearchAssetRecordsInput> = {},
): SearchAssetRecordsInput {
  return {
    ownerUserId: "user-1",
    query,
    limit: 8,
    includeArchived: false,
    includeReviewGated: false,
    plan: parseAssetSearchQuery(query),
    ...overrides,
  };
}

function renderRecords(query: string, overrides: Partial<SearchAssetRecordsInput> = {}) {
  const built = buildAssetSearchRecordsQuery(recordsInput(query, overrides));
  if (!built) {
    throw new Error(`Expected "${query}" to build a query.`);
  }
  return dialect.sqlToQuery(built);
}

/**
 * The exact failure signature of the bug this file guards. Handed a JS array, drizzle
 * does not bind a Postgres array — it flattens the array into one placeholder group,
 * `any(($1))`, and binds the element as a plain string. Postgres then reads that string
 * as an array literal and refuses it at runtime. So the guard is on the *shape of the
 * emitted SQL*: every `any(...)` must contain a spelled-out `array[...]` literal, and no
 * parameter may ever be an array.
 */
function expectNoFlattenedArrayBinding(rendered: { sql: string; params: unknown[] }): void {
  expect(rendered.sql).not.toMatch(/any\(\(/);
  for (const param of rendered.params) {
    expect(Array.isArray(param)).toBe(false);
  }
}

describe("asset search drizzle store — structured identifiers reach Postgres as scalars (#204)", () => {
  // The regression this file was written for: a serial/model/filter-size query used to
  // bind `['%RPWFE%']` as one parameter, and Postgres refused it with "malformed array
  // literal", taking the Assets page down with it.
  it("binds one scalar LIKE pattern per identifier, never a JS array", () => {
    const { sql, params } = renderRecords("RPWFE");

    expect(sql).toContain("upper(am.value_json->>'text') like any(array[");
    expect(sql).toContain("]::text[]");
    expect(params).toContain("%RPWFE%");
    expectNoFlattenedArrayBinding({ sql, params });
  });

  it("renders a multi-identifier query as a real array literal, not a comma splice", () => {
    const { sql, params } = renderRecords("EDR1RXD1 21-2100");

    // Two placeholders inside one `array[...]::text[]` — the shape that made the
    // single-element case fail is the same shape that would make this one a syntax error.
    expect(sql).toMatch(/like any\(array\[\$\d+, \$\d+\]::text\[\]\)/);
    expect(params).toEqual(expect.arrayContaining(["%21-2100%", "%EDR1RXD1%"]));
    expectNoFlattenedArrayBinding({ sql, params });
  });

  it("matches an all-caps model number typed on its own — the placeholder's own promise", () => {
    const { sql, params } = renderRecords("VIN");

    expect(sql).toContain("like any(array[");
    expect(params).toContain("%VIN%");
  });

  it("binds a typed amount and an ISO date as exact structured values", () => {
    const { sql, params } = renderRecords("$1,299.99 on 2026-03-14");

    expect(sql).toContain("(am.value_json->>'amount')::numeric");
    expect(sql).toContain("ae.purchased_on = ");
    expect(params).toContain(1299.99);
    expect(params).toContain("USD");
    expect(params).toContain("2026-03-14");
  });

  it("binds an asset-kind filter as a text[] of scalars — the same trap, one aisle over", () => {
    const { sql, params } = renderRecords("filter", { assetKinds: ["appliance", "vehicle"] });

    expect(sql).toMatch(/a\.kind::text = any\(array\[\$\d+, \$\d+\]::text\[\]\)/);
    expect(params).toEqual(expect.arrayContaining(["appliance", "vehicle"]));
    expectNoFlattenedArrayBinding({ sql, params });
  });

  it("never interpolates a user-typed identifier into the SQL text", () => {
    const { sql } = renderRecords("RPWFE'; drop table assets; --");

    expect(sql).not.toContain("drop table");
  });

  it("builds nothing at all for a query that names nothing", () => {
    expect(buildAssetSearchRecordsQuery(recordsInput("the a of"))).toBeNull();
  });
});

function embeddingsInput(
  overrides: Partial<SearchAssetEmbeddingsInput> = {},
): SearchAssetEmbeddingsInput {
  return {
    ownerUserId: "user-1",
    query: "boiler",
    limit: 8,
    includeArchived: false,
    includeReviewGated: false,
    queryEmbedding: [0.1, 0.2, 0.3],
    embeddingModel: "fake",
    embeddingVersion: "v1",
    ...overrides,
  };
}

describe("asset search drizzle store — the semantic tier is bounded (#204)", () => {
  it("applies the shared relevance floor and tier cap, not a bare `> 0`", () => {
    const { sql, params } = dialect.sqlToQuery(buildAssetSearchEmbeddingsQuery(embeddingsInput()));

    // `> 0` admits every embedded record the user owns and stamps it "Related" — the
    // whole corpus wearing a claim it has not earned.
    expect(sql).not.toContain("where similarity > 0");
    expect(sql).toContain("where similarity >= ");
    expect(params).toContain(ASSET_SEMANTIC_SIMILARITY_FLOOR);
    expect(params).toContain(ASSET_SEMANTIC_TIER_LIMIT);
  });
});

describe("asset search drizzle store guards (#204)", () => {
  it("gates every branch on a visible, durable anchor asset", () => {
    // Assets, memories, and evidence all read through the one shared predicate, and a
    // child record can never out-reach the thing it hangs off.
    expect(source).toContain("visibleHouseholdRecordSql");
    expect(source).toContain('recordKind: "asset_memory"');
    expect(source).toContain('recordKind: "asset_evidence"');
    const anchorGates = source.split("assetVisibleSql(input)").length - 1;
    expect(anchorGates).toBeGreaterThanOrEqual(5); // 3 record branches + 2 embedding branches
  });

  it("keeps the review gate owner-only in both tiers", () => {
    // A `suggested` memory is a proposal: it participates only in explicit review
    // context, and only for its own owner — the embedding index is not a back door
    // around the gate, so both queries must carry it.
    const rendered = [
      renderRecords("filter", { includeReviewGated: true }),
      dialect.sqlToQuery(
        buildAssetSearchEmbeddingsQuery(embeddingsInput({ includeReviewGated: true })),
      ),
    ];

    for (const { sql, params } of rendered) {
      expect(sql).toContain("am.status = 'suggested'");
      expect(sql).toMatch(/am\.owner_user_id = \$\d+/);
      // The flag is bound, never inlined — a caller cannot widen the gate by string.
      expect(params).toContain(true);
      expect(params).toContain("user-1");
    }
  });
});
