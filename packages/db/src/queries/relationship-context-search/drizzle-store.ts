import type { ExactRecallRecordKind, ExactRecallResult } from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { getDb } from "../../client";
import type { RelationshipContextSearchStore } from "./types";

type SearchRow = {
  record_kind: ExactRecallRecordKind;
  record_id: string;
  related_person_id: string | null;
  related_person_display_name: string | null;
  label: string;
  snippet: string;
  matched_fields: string[];
  rank: string | number;
  trust_level: "identity_reference" | "confirmed_fact" | "logged_context";
  sensitivity: "normal" | "sensitive" | "restricted";
};

export function createDrizzleRelationshipContextSearchStore(): RelationshipContextSearchStore {
  return {
    async searchRelationshipContext(input) {
      const rows = await getDb().execute(sql<SearchRow>`
        with search_query as (
          select websearch_to_tsquery('simple', ${input.query}) as query
        )
        select *
        from (
        select
          'person'::text as record_kind,
          p.id::text as record_id,
          p.id::text as related_person_id,
          p.display_name as related_person_display_name,
          p.display_name as label,
          case
            when p.profile_blurb is not null and p.profile_blurb <> ''
              then ts_headline('simple', p.profile_blurb, search_query.query, 'MaxWords=18, MinWords=6, ShortWord=2')
            else p.display_name
          end as snippet,
          array_remove(array[
            case when to_tsvector('simple', coalesce(p.display_name, '')) @@ search_query.query then 'displayName' end,
            case when to_tsvector('simple', coalesce(p.first_name, '')) @@ search_query.query then 'firstName' end,
            case when to_tsvector('simple', coalesce(p.last_name, '')) @@ search_query.query then 'lastName' end,
            case when to_tsvector('simple', coalesce(p.profile_blurb, '')) @@ search_query.query then 'profileBlurb' end
          ], null)::text[] as matched_fields,
          (
            ts_rank_cd(p.search_vector, search_query.query)
            + case when p.display_name ilike ${`%${input.query}%`} then 0.2 else 0 end
          )::float8 as rank,
          'identity_reference'::text as trust_level,
          'normal'::text as sensitivity
        from people p, search_query
        where
          p.owner_user_id = ${input.ownerUserId}
          and ${kindFilter(input.recordKinds, "person")}
          and ${input.personId ? sql`p.id = ${input.personId}` : sql`true`}
          and p.search_vector @@ search_query.query
        union all
        select
          'memory'::text as record_kind,
          m.id::text as record_id,
          m.person_id::text as related_person_id,
          p.display_name as related_person_display_name,
          p.display_name as label,
          ts_headline('simple', m.content, search_query.query, 'MaxWords=18, MinWords=6, ShortWord=2') as snippet,
          array['content']::text[] as matched_fields,
          (
            ts_rank_cd(m.search_vector, search_query.query)
            + (m.importance::float8 * 0.01)
          )::float8 as rank,
          'confirmed_fact'::text as trust_level,
          m.sensitivity::text as sensitivity
        from memories m
        inner join people p on p.id = m.person_id
        cross join search_query
        where
          m.owner_user_id = ${input.ownerUserId}
          and p.owner_user_id = ${input.ownerUserId}
          and ${kindFilter(input.recordKinds, "memory")}
          and ${input.personId ? sql`m.person_id = ${input.personId}` : sql`true`}
          and m.status = 'approved'
          and (${input.directlyRequested}::boolean or m.sensitivity <> 'restricted')
          and m.search_vector @@ search_query.query
        union all
        select
          'source_record'::text as record_kind,
          sr.id::text as record_id,
          related_person.id::text as related_person_id,
          related_person.display_name as related_person_display_name,
          coalesce(related_person.display_name, 'Logged note') as label,
          ts_headline('simple', sr.content, search_query.query, 'MaxWords=18, MinWords=6, ShortWord=2') as snippet,
          array['content']::text[] as matched_fields,
          (
            ts_rank_cd(sr.search_vector, search_query.query)
            + (sr.importance::float8 * 0.01)
          )::float8 as rank,
          'logged_context'::text as trust_level,
          sr.sensitivity::text as sensitivity
        from source_records sr
        left join lateral (
          select p.id, p.display_name
          from source_record_people srp
          inner join people p on p.id = srp.person_id
          where
            srp.source_record_id = sr.id
            and p.owner_user_id = ${input.ownerUserId}
            and ${input.personId ? sql`p.id = ${input.personId}` : sql`true`}
          order by case when srp.role = 'primary' then 0 else 1 end, p.display_name asc, p.id asc
          limit 1
        ) related_person on true
        cross join search_query
        where
          sr.owner_user_id = ${input.ownerUserId}
          and ${kindFilter(input.recordKinds, "source_record")}
          and ${input.personId ? sql`related_person.id = ${input.personId}` : sql`true`}
          and sr.status = 'active'
          and (${input.directlyRequested}::boolean or sr.sensitivity <> 'restricted')
          and sr.search_vector @@ search_query.query
        ) mixed_results
        order by rank desc, label asc, record_id asc
        limit ${input.limit}
      `);

      return (rows as unknown as SearchRow[]).map(toExactRecallResult);
    },
  };
}

function kindFilter(kinds: ExactRecallRecordKind[] | undefined, kind: ExactRecallRecordKind) {
  return !kinds || kinds.includes(kind) ? sql`true` : sql`false`;
}

function toExactRecallResult(row: SearchRow): ExactRecallResult {
  return {
    recordKind: row.record_kind,
    recordId: row.record_id,
    relatedPersonId: row.related_person_id,
    relatedPersonDisplayName: row.related_person_display_name,
    label: row.label,
    snippet: row.snippet,
    matchedFields: row.matched_fields,
    rank: Number(row.rank),
    trustLevel: row.trust_level,
    sensitivity: row.sensitivity,
  };
}
