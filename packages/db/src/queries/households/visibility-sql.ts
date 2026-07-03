import { sql } from "drizzle-orm";

export function visibleHouseholdRecordSql(input: {
  callerUserId: string;
  tableAlias: "m" | "sr";
  recordKind: "memory" | "source_record";
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
