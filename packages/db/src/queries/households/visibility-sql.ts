import { sql } from "drizzle-orm";
import type { VisibilityRecordKind, VisibilityRecordTableAlias } from "./types";

/**
 * The audience rule pushed into SQL so an out-of-scope row never leaves the
 * database. It is the read-side **pre-filter**, not the whole proof: it can see
 * ownership, scope, active membership, and the share registry, and it cannot see
 * a domain's lifecycle, sensitivity, or exclusion facts.
 *
 * A listing whose records carry any of those — or any caller doing something to
 * a row rather than reading it — proves the record through
 * `createHouseholdAuthorizationProver` as well. This predicate narrows the
 * candidate set; it never authorizes an operation (ADR 0219).
 */
export function visibleHouseholdRecordSql(input: {
  callerUserId: string;
  tableAlias: VisibilityRecordTableAlias;
  recordKind: VisibilityRecordKind;
}) {
  const record = sql.raw(input.tableAlias);

  return sql`(
    (${record}.scope = 'private' and ${record}.owner_user_id = ${input.callerUserId})
    or (
      ${record}.scope = 'household'
      and ${record}.household_id is not null
      and exists (
        select 1
        from household_memberships hm
        where hm.household_id = ${record}.household_id
          and hm.user_id = ${input.callerUserId}
          and hm.status = 'active'
      )
    )
    or (
      ${record}.scope = 'shared'
      and ${record}.household_id is not null
      and exists (
        select 1
        from household_memberships hm
        where hm.household_id = ${record}.household_id
          and hm.user_id = ${input.callerUserId}
          and hm.status = 'active'
      )
      and (
        ${record}.owner_user_id = ${input.callerUserId}
        or exists (
          select 1
          from household_record_shares hrs
          where hrs.household_id = ${record}.household_id
            and hrs.record_kind = ${input.recordKind}
            and hrs.record_id = ${record}.id
            and hrs.shared_with_user_id = ${input.callerUserId}
        )
      )
    )
  )`;
}
