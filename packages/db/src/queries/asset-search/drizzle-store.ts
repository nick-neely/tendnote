import {
  type AssetKind,
  type AssetMemoryValue,
  type AssetSearchCandidate,
  type AssetSearchRecordKind,
  type AssetSearchTrustLevel,
  buildAssetSearchTsQuery,
  type PrivacyScope,
  visibilityChoiceForScope,
  visibilityLabelForScope,
} from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { getDb } from "../../client";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import type {
  AssetSearchStore,
  SearchAssetEmbeddingsInput,
  SearchAssetRecordsInput,
} from "./types";

type SearchRow = {
  record_kind: AssetSearchRecordKind;
  record_id: string;
  asset_id: string;
  asset_name: string;
  asset_kind: AssetKind;
  asset_status: "active" | "archived";
  label: string;
  snippet: string;
  scope: PrivacyScope;
  value_json: AssetMemoryValue | null;
  trust_level: AssetSearchTrustLevel;
  source_record_id: string | null;
  // A row can match lexically, structurally, or both — the mapper expands one row into
  // one candidate per signal, so the fusion can report every way a record was found.
  exact_rank: string | number | null;
  structured_match: boolean;
  matched_fields: string[];
};

/**
 * The lexical and structured tiers of Asset Search, as one SQL pass over Assets,
 * Asset Memories, and Asset Evidence (#204).
 *
 * Two properties are load-bearing and must never be traded away:
 *
 * 1. **Visibility is deterministic and pre-retrieval.** Every branch applies the
 *    shared `visibleHouseholdRecordSql` predicate to the record *and* to its anchor
 *    asset, so a private child record under a household asset never reaches the
 *    caller — and never even leaves the database. There is no post-filter in TS.
 * 2. **The review gate is owner-only.** A `suggested` Asset Memory is a proposal, not
 *    a fact; it participates only when the caller asked for review context *and* owns
 *    it. A household member can never see another member's un-accepted proposal,
 *    whatever flag is passed.
 */
/** A thin factory over module-scope SQL builders (the repo's fallow factory pattern). */
export function createDrizzleAssetSearchStore(): AssetSearchStore {
  return {
    searchAssetRecords,
    searchAssetEmbeddings,
  };
}

/** The structured intent, resolved once so the SQL builders stay branch-free. */
type StructuredPlan = {
  amount: number | null;
  currency: string | null;
  date: string | null;
  identifiers: string[];
};

function toStructuredPlan(input: SearchAssetRecordsInput): StructuredPlan {
  return {
    amount: input.plan.amount?.amount ?? null,
    currency: input.plan.amount?.currency ?? null,
    date: input.plan.date ?? null,
    identifiers: input.plan.identifiers,
  };
}

/** True when the query names nothing at all — no lexical term and no structured value. */
function planIsEmpty(tsQuery: string | null, structured: StructuredPlan): boolean {
  return (
    !tsQuery &&
    structured.amount === null &&
    structured.date === null &&
    structured.identifiers.length === 0
  );
}

async function searchAssetRecords(input: SearchAssetRecordsInput) {
  const tsQuery = buildAssetSearchTsQuery(input.plan);
  const structured = toStructuredPlan(input);

  if (planIsEmpty(tsQuery, structured)) {
    return [];
  }

  const { amount, currency, date, identifiers } = structured;

  const rows = await getDb().execute(sql`
        with search_query as (
          select ${tsQuery ? sql`to_tsquery('simple', ${tsQuery})` : sql`null::tsquery`} as query
        )
        select * from (
          select
            'asset'::text as record_kind,
            a.id::text as record_id,
            a.id::text as asset_id,
            a.name as asset_name,
            a.kind::text as asset_kind,
            a.status::text as asset_status,
            a.name as label,
            a.name as snippet,
            a.scope::text as scope,
            null::jsonb as value_json,
            'asset_anchor'::text as trust_level,
            null::text as source_record_id,
            ts_rank_cd(a.search_vector, search_query.query)::float8 as exact_rank,
            false as structured_match,
            array['name']::text[] as matched_fields
          from assets a, search_query
          where
            ${assetVisibleSql(input)}
            and ${kindFilter(input, "asset")}
            and search_query.query is not null
            and a.search_vector @@ search_query.query

          union all

          select
            'asset_memory'::text as record_kind,
            am.id::text as record_id,
            a.id::text as asset_id,
            a.name as asset_name,
            a.kind::text as asset_kind,
            a.status::text as asset_status,
            am.label as label,
            case
              when am.value_json is not null
                then am.label || ': ' || coalesce(
                  am.value_json->>'text',
                  am.value_json->>'date',
                  (am.value_json->>'amount') || ' ' || coalesce(am.value_json->>'currency', ''),
                  ''
                )
              else am.label
            end as snippet,
            am.scope::text as scope,
            am.value_json as value_json,
            case when am.status = 'suggested' then 'suggested_asset_fact' else 'asset_fact' end as trust_level,
            am.source_record_id::text as source_record_id,
            case
              when search_query.query is not null and am.search_vector @@ search_query.query
                then ts_rank_cd(am.search_vector, search_query.query)::float8
              else null::float8
            end as exact_rank,
            ${memoryStructuredMatchSql(amount, currency, date, identifiers)} as structured_match,
            array_remove(array[
              case when search_query.query is not null and to_tsvector('simple', coalesce(am.label, '')) @@ search_query.query then 'label' end,
              case when search_query.query is not null and to_tsvector('simple', coalesce(am.notes, '')) @@ search_query.query then 'notes' end,
              case when search_query.query is not null and to_tsvector('simple', coalesce(am.value_json->>'text', '')) @@ search_query.query then 'value' end
            ], null)::text[] as matched_fields
          from asset_memories am
          inner join assets a on a.id = am.asset_id
          cross join search_query
          where
            ${assetVisibleSql(input)}
            and ${kindFilter(input, "asset_memory")}
            and ${visibleHouseholdRecordSql({
              callerUserId: input.ownerUserId,
              tableAlias: "am",
              recordKind: "asset_memory",
            })}
            -- A dismissed memory is a resolved husk; a suggested one is an owner-only
            -- proposal that surfaces only in explicit review context (ADRs 0151-0153).
            and (
              am.status = 'active'
              or (
                ${input.includeReviewGated}::boolean
                and am.status = 'suggested'
                and am.owner_user_id = ${input.ownerUserId}
              )
            )
            and (
              (search_query.query is not null and am.search_vector @@ search_query.query)
              or ${memoryStructuredMatchSql(amount, currency, date, identifiers)}
            )

          union all

          select
            'asset_evidence'::text as record_kind,
            ae.id::text as record_id,
            a.id::text as asset_id,
            a.name as asset_name,
            a.kind::text as asset_kind,
            a.status::text as asset_status,
            ae.label as label,
            coalesce(nullif(ae.captured_text, ''), ae.label) as snippet,
            ae.scope::text as scope,
            null::jsonb as value_json,
            'asset_evidence'::text as trust_level,
            ae.source_record_id::text as source_record_id,
            case
              when search_query.query is not null and ae.search_vector @@ search_query.query
                then ts_rank_cd(ae.search_vector, search_query.query)::float8
              else null::float8
            end as exact_rank,
            ${evidenceStructuredMatchSql(amount, currency, date)} as structured_match,
            array['label']::text[] as matched_fields
          from asset_evidence ae
          inner join assets a on a.id = ae.asset_id
          cross join search_query
          where
            ${assetVisibleSql(input)}
            and ${kindFilter(input, "asset_evidence")}
            and ${visibleHouseholdRecordSql({
              callerUserId: input.ownerUserId,
              tableAlias: "ae",
              recordKind: "asset_evidence",
            })}
            and (
              (search_query.query is not null and ae.search_vector @@ search_query.query)
              or ${evidenceStructuredMatchSql(amount, currency, date)}
            )
        ) matches
        order by coalesce(exact_rank, 0) desc, label asc, record_id asc
        limit ${RECORD_TIER_ROW_LIMIT}
      `);

  return (rows as unknown as SearchRow[]).flatMap(toCandidates);
}

async function searchAssetEmbeddings(input: SearchAssetEmbeddingsInput) {
  const queryVector = `[${input.queryEmbedding.join(",")}]`;

  const rows = await getDb().execute(sql`
        select * from (
          select
            'asset'::text as record_kind,
            a.id::text as record_id,
            a.id::text as asset_id,
            a.name as asset_name,
            a.kind::text as asset_kind,
            a.status::text as asset_status,
            a.name as label,
            a.name as snippet,
            a.scope::text as scope,
            null::jsonb as value_json,
            'asset_anchor'::text as trust_level,
            null::text as source_record_id,
            (1 - (e.embedding <=> ${queryVector}::vector))::float8 as similarity
          from relationship_context_embeddings e
          inner join assets a on a.id = e.record_id
          where
            -- The embedding belongs to the *record's* owner, not the caller: a household
            -- asset owned by another member is embedded under their id, and must still be
            -- semantically findable by every member who can see it. Access is decided by
            -- the visibility predicate below — never by who happens to own the vector
            -- (mirrors the relationship-retrieval store).
            e.owner_user_id = a.owner_user_id
            and e.record_kind = 'asset'
            and e.embedding_model = ${input.embeddingModel}
            and e.embedding_version = ${input.embeddingVersion}
            and e.embedding_dimensions = ${input.queryEmbedding.length}
            and ${assetVisibleSql(input)}
            and ${kindFilter(input, "asset")}

          union all

          select
            'asset_memory'::text as record_kind,
            am.id::text as record_id,
            a.id::text as asset_id,
            a.name as asset_name,
            a.kind::text as asset_kind,
            a.status::text as asset_status,
            am.label as label,
            case
              when am.value_json is not null
                then am.label || ': ' || coalesce(
                  am.value_json->>'text',
                  am.value_json->>'date',
                  (am.value_json->>'amount') || ' ' || coalesce(am.value_json->>'currency', ''),
                  ''
                )
              else am.label
            end as snippet,
            am.scope::text as scope,
            am.value_json as value_json,
            case when am.status = 'suggested' then 'suggested_asset_fact' else 'asset_fact' end as trust_level,
            am.source_record_id::text as source_record_id,
            (1 - (e.embedding <=> ${queryVector}::vector))::float8 as similarity
          from relationship_context_embeddings e
          inner join asset_memories am on am.id = e.record_id
          inner join assets a on a.id = am.asset_id
          where
            -- As above: the vector is owned by whoever wrote the memory, and visibility —
            -- not vector ownership — decides who may retrieve it.
            e.owner_user_id = am.owner_user_id
            and e.record_kind = 'asset_memory'
            and e.embedding_model = ${input.embeddingModel}
            and e.embedding_version = ${input.embeddingVersion}
            and e.embedding_dimensions = ${input.queryEmbedding.length}
            and ${assetVisibleSql(input)}
            and ${kindFilter(input, "asset_memory")}
            and ${visibleHouseholdRecordSql({
              callerUserId: input.ownerUserId,
              tableAlias: "am",
              recordKind: "asset_memory",
            })}
            -- The embedding index is not a back door around the review gate.
            and (
              am.status = 'active'
              or (
                ${input.includeReviewGated}::boolean
                and am.status = 'suggested'
                and am.owner_user_id = ${input.ownerUserId}
              )
            )
        ) matches
        where similarity > 0
        order by round(similarity::numeric, 4) desc, label asc, record_id asc
        limit ${RECORD_TIER_ROW_LIMIT}
      `);

  return (rows as unknown as Array<SearchRow & { similarity: number }>).map((row) => ({
    ...baseCandidate(row),
    matchedFields: ["semantic"],
    matchKind: "semantic" as const,
    sourceScore: Number(row.similarity),
  }));
}

/**
 * How many rows each tier may contribute before fusion. Generous relative to the
 * caller's `limit`, because the merge — not the SQL — decides the final ranking: a
 * record cut here could have been the top result once a second signal corroborated it.
 */
const RECORD_TIER_ROW_LIMIT = 60;

/**
 * The anchor gate, in SQL: the asset must be durable, visible to the caller, and pass
 * the caller's archive and kind filters. Applied to *every* branch — a memory or a
 * receipt can never surface for an asset the caller cannot see.
 */
function assetVisibleSql(input: {
  ownerUserId: string;
  includeArchived: boolean;
  assetId?: string;
  assetKinds?: AssetKind[];
}) {
  return sql`(
    ${visibleHouseholdRecordSql({
      callerUserId: input.ownerUserId,
      tableAlias: "a",
      recordKind: "asset",
    })}
    and a.status in ${input.includeArchived ? sql`('active', 'archived')` : sql`('active')`}
    and ${input.assetId ? sql`a.id = ${input.assetId}` : sql`true`}
    and ${
      input.assetKinds && input.assetKinds.length > 0
        ? sql`a.kind::text = any(${input.assetKinds})`
        : sql`true`
    }
  )`;
}

function kindFilter(input: { recordKinds?: AssetSearchRecordKind[] }, kind: AssetSearchRecordKind) {
  return !input.recordKinds || input.recordKinds.includes(kind) ? sql`true` : sql`false`;
}

/**
 * A typed memory value matches the query's structured intent: the same amount and
 * currency, the same calendar date, or a text value containing an identifier the user
 * typed. Exact by construction — there is no partial credit for an exact fact.
 */
function memoryStructuredMatchSql(
  amount: number | null,
  currency: string | null,
  date: string | null,
  identifiers: string[],
) {
  const clauses = [
    amount !== null && currency
      ? sql`(am.value_json->>'type' = 'amount' and (am.value_json->>'amount')::numeric = ${amount}::numeric and am.value_json->>'currency' = ${currency})`
      : null,
    date ? sql`(am.value_json->>'type' = 'date' and am.value_json->>'date' = ${date})` : null,
    identifiers.length > 0
      ? sql`(am.value_json->>'type' = 'text' and upper(am.value_json->>'text') like any(${identifiers.map((identifier) => `%${identifier}%`)}))`
      : null,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);

  if (clauses.length === 0) {
    return sql`false`;
  }

  return sql`(${sql.join(clauses, sql` or `)})`;
}

/** The evidence equivalent: a receipt amount, a purchase date, or a renewal date. */
function evidenceStructuredMatchSql(
  amount: number | null,
  currency: string | null,
  date: string | null,
) {
  const clauses = [
    amount !== null && currency
      ? sql`((ae.money_json->>'amount')::numeric = ${amount}::numeric and ae.money_json->>'currency' = ${currency})`
      : null,
    // Dates are compared against the real `date` columns rather than a text vector —
    // exact, index-friendly, and immune to the locale-dependent cast that keeps them
    // out of the generated search vector.
    date ? sql`(ae.purchased_on = ${date}::date or ae.renews_on = ${date}::date)` : null,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);

  if (clauses.length === 0) {
    return sql`false`;
  }

  return sql`(${sql.join(clauses, sql` or `)})`;
}

function baseCandidate(row: SearchRow) {
  return {
    recordKind: row.record_kind,
    recordId: row.record_id,
    assetId: row.asset_id,
    assetName: row.asset_name,
    assetKind: row.asset_kind,
    assetStatus: row.asset_status,
    label: row.label,
    snippet: row.snippet,
    value: row.value_json,
    trustLevel: row.trust_level,
    visibilityChoice: visibilityChoiceForScope(row.scope),
    visibilityLabel: visibilityLabelForScope(row.scope),
    citations: citationsFor(row),
  };
}

/**
 * Every result cites the rows it stands on: the record itself, the Asset it hangs off,
 * and — when the record was captured from one — the source record that grounds it. This
 * is what lets Eve answer an asset question and show its work (#196 user story 55).
 */
function citationsFor(row: SearchRow): AssetSearchCandidate["citations"] {
  const citations: AssetSearchCandidate["citations"] = [
    { kind: row.record_kind, id: row.record_id },
  ];

  if (row.record_kind !== "asset") {
    citations.push({ kind: "asset", id: row.asset_id });
  }

  if (row.source_record_id) {
    citations.push({ kind: "source_record", id: row.source_record_id });
  }

  return citations;
}

/**
 * Expands one matched row into a candidate per signal that found it. A memory whose
 * label matched the text *and* whose typed value matched exactly is two candidates —
 * the fusion collapses them back into one result reporting both, ranked by the
 * stronger signal.
 */
function toCandidates(row: SearchRow): AssetSearchCandidate[] {
  const base = baseCandidate(row);
  const candidates: AssetSearchCandidate[] = [];
  const exactRank = row.exact_rank === null ? null : Number(row.exact_rank);

  if (exactRank !== null && exactRank > 0) {
    candidates.push({
      ...base,
      matchedFields: row.matched_fields.length > 0 ? row.matched_fields : ["label"],
      matchKind: "exact",
      // ts_rank_cd is unbounded; squash it into (0,1) so the three signals share one
      // comparable scale for fusion.
      sourceScore: exactRank / (exactRank + 1),
    });
  }

  if (row.structured_match) {
    candidates.push({
      ...base,
      matchedFields: ["value"],
      matchKind: "structured",
      sourceScore: 1,
    });
  }

  return candidates;
}
