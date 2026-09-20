import { randomUUID } from "node:crypto";
import { getDb } from "@tendnote/db/client";
import { addAssetEvidenceToNewAsset } from "@tendnote/db/queries/assets";
import {
  createDefaultCalendarReader,
  createFakeCalendarAdapter,
} from "@tendnote/db/queries/calendar";
import { people, providerConnections, reminderOptInStates, user } from "@tendnote/db/schema";
import { sql } from "drizzle-orm";
import { replayPersonName, type Workload } from "./workload";

export const ownerUserId = "cost-replay-user";
export async function seedMonth(workload: Workload) {
  const db = getDb();
  await db.insert(user).values({
    id: ownerUserId,
    name: "Synthetic Cost Customer",
    email: "cost-replay@example.invalid",
  });
  const persons = Array.from({ length: workload.people }, (_, i) => ({
    id: randomUUID(),
    ownerUserId,
    displayName: replayPersonName(i),
    firstName: "Avery",
    lastName: replayPersonName(i).split(" ")[1],
    birthday: `1990-09-${String((i % 28) + 1).padStart(2, "0")}`,
    relationshipType: "friend" as const,
    profileBlurb: "Fictional person for the Representative Month cost replay.",
  }));
  await db.insert(people).values(persons);
  await db.insert(providerConnections).values({
    ownerUserId,
    providerKey: "google",
    capabilityKey: "calendar",
    status: "connected",
    displayIdentity: "cost-replay@example.invalid",
    connectedAt: new Date(),
  });
  await db.insert(reminderOptInStates).values({
    ownerUserId,
    clientInstallationId: "synthetic-no-push-endpoint",
    state: "registered",
    offeredAt: new Date(),
  });
  return persons;
}

export function syntheticCalendar() {
  return createDefaultCalendarReader(
    createFakeCalendarAdapter((input) => [
      {
        providerEventId: `replay-${input.timeMin.toISOString().slice(0, 10)}`,
        calendarId: "primary",
        title: "Fictional catch-up",
        start: new Date(input.timeMin.getTime() + 3600000),
        end: new Date(input.timeMin.getTime() + 7200000),
        allDay: false,
        status: "confirmed",
        attendees: [],
        location: null,
        description: "Synthetic calendar fixture; no Google request.",
        updatedAt: null,
      },
    ]),
  );
}

export async function uploadEvidence(index: number) {
  // Valid minimal PDF padded to the documented storage hypothesis. No vision or
  // OCR is performed by the product's evidence-storage entry point.
  const header = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  );
  const bytes = Buffer.alloc(65536, 32);
  header.copy(bytes);
  await addAssetEvidenceToNewAsset({
    ownerUserId,
    asset: { name: `Fictional appliance ${index}`, kind: "appliance" },
    kind: "manual",
    label: `Synthetic manual ${index}`,
    file: {
      fileName: `manual-${index}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      bytes,
    },
  });
}

export async function storedActivity() {
  const db = getDb();
  const tables = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'owner_user_id' order by table_name`,
  );
  const counts: Record<string, number> = {};
  let logicalRowBytes = 0;
  for (const { table_name: table } of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected table identifier");
    const rows = await db.execute<{ count: string; bytes: string }>(
      sql`select count(*) as count, coalesce(sum(pg_column_size(t)), 0) as bytes from ${sql.identifier(table)} t where owner_user_id = ${ownerUserId}`,
    );
    counts[table] = Number(requireRow(rows).count);
    logicalRowBytes += Number(requireRow(rows).bytes);
  }
  const files = await db.execute<{ bytes: string }>(
    sql`select coalesce(sum(octet_length(bytes)), 0) as bytes from asset_evidence_files where owner_user_id = ${ownerUserId}`,
  );
  const failed = await db.execute<{ count: string }>(
    sql`select count(*) as count from (select j.status::text from extraction_jobs j join source_records s on s.id = j.source_record_id where s.owner_user_id = ${ownerUserId} union all select j.status::text from action_extraction_jobs j join source_records s on s.id = j.source_record_id where s.owner_user_id = ${ownerUserId} union all select status::text from context_fact_extraction_jobs where owner_user_id = ${ownerUserId} union all select status::text from relationship_context_embedding_jobs where owner_user_id = ${ownerUserId}) jobs where status::text not in ('completed', 'skipped')`,
  );
  return {
    counts,
    logicalRowBytes,
    evidenceFileBytes: Number(requireRow(files).bytes),
    unfinishedBackgroundJobs: Number(requireRow(failed).count),
  };
}

function requireRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("Missing aggregate result");
  return row;
}
