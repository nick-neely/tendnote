import { getDb } from "@tendnote/db/client";
import { sql } from "drizzle-orm";
import { ownerUserId } from "./fixtures";
import type { PlannedTurn } from "./workload";

type Row = { id: string; kind: "source" | "memory" | "followup"; dueDate: string | null };
export async function personOutcomes(personId: string): Promise<Row[]> {
  return getDb().execute<Row>(sql`
    select s.id::text, 'source'::text as kind, null::text as "dueDate"
    from source_records s where s.owner_user_id = ${ownerUserId}
      and s.status = 'active' and s.scope = 'private'
      and (exists (select 1 from source_record_people p where p.source_record_id = s.id and p.person_id = ${personId})
        or exists (select 1 from memories m where m.source_record_id = s.id and m.person_id = ${personId} and m.owner_user_id = ${ownerUserId}))
    union all
    select id::text, 'memory', null::text from memories
      where owner_user_id = ${ownerUserId} and person_id = ${personId}
      and status = 'approved' and scope = 'private'
    union all
    select id::text, 'followup', to_char(due_at at time zone 'UTC', 'YYYY-MM-DD') from followups
      where owner_user_id = ${ownerUserId} and person_id = ${personId}
      and status = 'open' and scope = 'private'
  `);
}

export function assertTurnOutcomes(step: PlannedTurn, before: Row[], after: Row[]) {
  const newRows = after.filter(
    (row) => !before.some((old) => old.id === row.id && old.kind === row.kind),
  );
  const sources = newRows.filter((row) => row.kind === "source");
  const memories = newRows.filter((row) => row.kind === "memory");
  const followups = newRows.filter((row) => row.kind === "followup");
  if (step.capture && sources.length !== 1)
    throw new Error("Expected one new private person-linked source record");
  if (memories.length !== Number(step.explicit))
    throw new Error("Confirmed Memory outcome differs from the planned capture authority");
  if (
    followups.length !== Number(step.followup) ||
    followups.some((row) => row.dueDate !== step.dueDate)
  )
    throw new Error("Follow-Up outcome missing, duplicated, or on the wrong date");
  if (!step.capture && !step.followup && sources.length)
    throw new Error("Read-only recall unexpectedly captured relationship context");
}
