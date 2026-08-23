import {
  type ExactRecallRecordKind,
  type ExactRecallResult,
  type GeneralActionStatus,
  visibilityChoiceForScope,
  visibilityLabelForScope,
} from "@tendnote/domain";
import { sql } from "drizzle-orm";
import { getDb } from "../../client";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import type { RelationshipContextSearchStore, SearchRelationshipContextQueryInput } from "./types";

type SearchRow = {
  record_kind: ExactRecallRecordKind;
  record_id: string;
  owner_user_id: string | null;
  household_id: string | null;
  scope: "private" | "shared" | "household" | null;
  related_person_id: string | null;
  related_person_display_name: string | null;
  label: string;
  snippet: string;
  matched_fields: string[];
  rank: string | number;
  trust_level: "identity_reference" | "confirmed_fact" | "logged_context" | "action_item";
  sensitivity: "normal" | "sensitive" | "restricted";
  // Populated only for `general_action` rows (AC4). Null for every other kind.
  general_action_status: GeneralActionStatus | null;
  general_action_is_routine: boolean | null;
  general_action_area_id: string | null;
};

/**
 * `ts_headline` wraps every matched term in `<b>...</b>` unless told otherwise,
 * and nothing downstream renders HTML - a snippet is plain text in the recall
 * result rows and in the agent's search tool alike. `StartSel`/`StopSel` are
 * emptied so the tags do not leak into the reading surface as literal markup.
 */
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
          null::text as owner_user_id,
          null::text as household_id,
          null::text as scope,
          p.id::text as related_person_id,
          p.display_name as related_person_display_name,
          p.display_name as label,
          case
            when p.profile_blurb is not null and p.profile_blurb <> ''
              then ts_headline('simple', p.profile_blurb, search_query.query, 'MaxWords=18, MinWords=6, ShortWord=2, StartSel="", StopSel=""')
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
            + (extract(epoch from p.updated_at)::float8 / 1000000000000)
          )::float8 as rank,
          'identity_reference'::text as trust_level,
          'normal'::text as sensitivity,
          null::text as general_action_status,
          null::boolean as general_action_is_routine,
          null::text as general_action_area_id
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
          m.owner_user_id::text as owner_user_id,
          m.household_id::text as household_id,
          m.scope::text as scope,
          p.id::text as related_person_id,
          p.display_name as related_person_display_name,
          coalesce(p.display_name, 'Memory') as label,
          ts_headline('simple', m.content, search_query.query, 'MaxWords=18, MinWords=6, ShortWord=2, StartSel="", StopSel=""') as snippet,
          array['content']::text[] as matched_fields,
          (
            ts_rank_cd(m.search_vector, search_query.query)
            + (m.importance::float8 * 0.01)
            + (extract(epoch from m.updated_at)::float8 / 1000000000000)
          )::float8 as rank,
          'confirmed_fact'::text as trust_level,
          m.sensitivity::text as sensitivity,
          null::text as general_action_status,
          null::boolean as general_action_is_routine,
          null::text as general_action_area_id
        from memories m
        left join people p on p.id = m.person_id and p.owner_user_id = ${input.ownerUserId}
        cross join search_query
        where
          ${visibleHouseholdRecordSql({
            callerUserId: input.ownerUserId,
            tableAlias: "m",
            recordKind: "memory",
          })}
          and ${kindFilter(input.recordKinds, "memory")}
          and ${input.personId ? sql`p.id = ${input.personId}` : sql`true`}
          and m.status = 'approved'
          and (${input.directlyRequested}::boolean or m.sensitivity <> 'restricted')
          and m.search_vector @@ search_query.query
        union all
        select
          'source_record'::text as record_kind,
          sr.id::text as record_id,
          sr.owner_user_id::text as owner_user_id,
          sr.household_id::text as household_id,
          sr.scope::text as scope,
          related_person.id::text as related_person_id,
          related_person.display_name as related_person_display_name,
          coalesce(related_person.display_name, 'Logged note') as label,
          ts_headline('simple', sr.content, search_query.query, 'MaxWords=18, MinWords=6, ShortWord=2, StartSel="", StopSel=""') as snippet,
          array['content']::text[] as matched_fields,
          (
            ts_rank_cd(sr.search_vector, search_query.query)
            + (sr.importance::float8 * 0.01)
            + (extract(epoch from sr.updated_at)::float8 / 1000000000000)
          )::float8 as rank,
          'logged_context'::text as trust_level,
          sr.sensitivity::text as sensitivity,
          null::text as general_action_status,
          null::boolean as general_action_is_routine,
          null::text as general_action_area_id
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
          ${visibleHouseholdRecordSql({
            callerUserId: input.ownerUserId,
            tableAlias: "sr",
            recordKind: "source_record",
          })}
          and ${kindFilter(input.recordKinds, "source_record")}
          and ${input.personId ? sql`related_person.id = ${input.personId}` : sql`true`}
          and sr.status = 'active'
          and (${input.directlyRequested}::boolean or sr.sensitivity <> 'restricted')
          and ${withoutProvenanceDuplicateSql(input)}
          and sr.search_vector @@ search_query.query
        union all
        select
          'general_action'::text as record_kind,
          ga.id::text as record_id,
          ga.owner_user_id::text as owner_user_id,
          ga.household_id::text as household_id,
          ga.scope::text as scope,
          null::text as related_person_id,
          null::text as related_person_display_name,
          ga.title as label,
          ts_headline(
            'simple',
            coalesce(ga.title, '') || ' ' || coalesce(ga.notes, ''),
            search_query.query,
            'MaxWords=18, MinWords=6, ShortWord=2, StartSel="", StopSel=""'
          ) as snippet,
          coalesce(
            nullif(
              array_remove(array[
                case when to_tsvector('simple', coalesce(ga.title, '')) @@ search_query.query then 'title' end,
                case when to_tsvector('simple', coalesce(ga.notes, '')) @@ search_query.query then 'notes' end
              ], null),
              '{}'
            ),
            array['title']
          )::text[] as matched_fields,
          (
            ts_rank_cd(ga.search_vector, search_query.query)
            + (extract(epoch from ga.updated_at)::float8 / 1000000000000)
          )::float8 as rank,
          'action_item'::text as trust_level,
          'normal'::text as sensitivity,
          ga.status::text as general_action_status,
          (ga.recurrence is not null) as general_action_is_routine,
          ga.area_id::text as general_action_area_id
        from general_actions ga, search_query
        where
          ${kindFilter(input.recordKinds, "general_action")}
          -- General Actions are not person-relationship context (ADRs 0143, 0155): a
          -- person-scoped query never returns them.
          and (${input.personId ? sql`false` : sql`true`})
          -- Scope filtering happens here, pre-retrieval (ADR 0153, AC5). This inlines the
          -- domain canRetrieveGeneralAction policy in SQL: a durable action
          -- (open/deferred/paused) is admitted only for a caller who may see it, and a
          -- suggested proposal only in owner-only review context, never scope-visible to
          -- a household member (ADRs 0151-0153, AC3). Ignored and terminal never surface.
          and (
            (
              ${visibleHouseholdRecordSql({
                callerUserId: input.ownerUserId,
                tableAlias: "ga",
                recordKind: "general_action",
              })}
              and (
                ga.status in ('open', 'deferred', 'paused')
                or (
                  ${input.includeArchived}::boolean
                  and ga.status in ('completed', 'dismissed', 'archived')
                )
              )
            )
            or (
              ${input.includeReviewGated}::boolean
              and ga.owner_user_id = ${input.ownerUserId}
              and ga.status = 'suggested'
            )
          )
          and ga.search_vector @@ search_query.query
        ) mixed_results
        where ${visibilityScopeSql(input, "mixed_results")}
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

function visibilityScopeSql(
  input: SearchRelationshipContextQueryInput,
  tableAlias: "mixed_results" | "m",
) {
  if (input.visibilityScope === "all_visible") return sql`true`;
  if (input.visibilityScope === "private_only") {
    return tableAlias === "m" ? sql`m.scope = 'private'` : sql`mixed_results.scope = 'private'`;
  }
  return tableAlias === "m"
    ? sql`m.scope in ('shared', 'household')`
    : sql`mixed_results.scope in ('shared', 'household')`;
}

/**
 * Explicit memory capture writes the memory's own provenance note: the source record it
 * hangs from carries the very same sentence the owner confirmed (`memories/capture.ts`
 * defaults the retained content to the memory content). Both rows are real, and both match
 * the same words, so recall used to answer one fact twice - the confirmed memory and its
 * receipt, verbatim, in adjacent rows.
 *
 * A note is withheld only when it adds nothing: an approved memory grounded in that record
 * repeats its text and is itself admissible for this same search - visible under household
 * scope, past the restricted-sensitivity gate, inside the person filter, and of a record
 * kind the caller actually asked for. A note that says more than the memory it grounds
 * still stands on its own, and a suppressed memory never takes its note down with it.
 */
function withoutProvenanceDuplicateSql(input: SearchRelationshipContextQueryInput) {
  return sql`not exists (
    select 1
    from memories m
    where
      m.source_record_id = sr.id
      and m.status = 'approved'
      and ${kindFilter(input.recordKinds, "memory")}
      and ${input.personId ? sql`m.person_id = ${input.personId}` : sql`true`}
      and (${input.directlyRequested}::boolean or m.sensitivity <> 'restricted')
      and ${visibleHouseholdRecordSql({
        callerUserId: input.ownerUserId,
        tableAlias: "m",
        recordKind: "memory",
      })}
      and ${visibilityScopeSql(input, "m")}
      and m.search_vector @@ search_query.query
      and regexp_replace(btrim(m.content), '\\s+', ' ', 'g')
        = regexp_replace(btrim(sr.content), '\\s+', ' ', 'g')
  )`;
}

function toExactRecallResult(row: SearchRow): ExactRecallResult {
  return {
    recordKind: row.record_kind,
    recordId: row.record_id,
    visibilityChoice: row.scope ? visibilityChoiceForScope(row.scope) : null,
    visibilityLabel: row.scope ? visibilityLabelForScope(row.scope) : null,
    relatedPersonId: row.related_person_id,
    relatedPersonDisplayName: row.related_person_display_name,
    label: row.label,
    snippet: row.snippet,
    matchedFields: row.matched_fields,
    rank: Number(row.rank),
    trustLevel: row.trust_level,
    sensitivity: row.sensitivity,
    generalAction:
      row.record_kind === "general_action" && row.general_action_status
        ? {
            status: row.general_action_status,
            isRoutine: Boolean(row.general_action_is_routine),
            isSuggested: row.general_action_status === "suggested",
            areaId: row.general_action_area_id,
          }
        : null,
  };
}
