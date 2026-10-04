import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../client";
import { briefItems, briefs } from "../../schema";
import type { OwnerDataExportSensitivityLabel } from "./shared";

/** Ownership facts for draft provenance; generated briefs are not portable resources. */
export type DraftBriefEntryPoint = {
  id: string;
  ownerUserId: string;
  sensitivity: OwnerDataExportSensitivityLabel;
};

export async function loadDraftBriefEntryPoints(
  ownerUserId: string,
  ids: string[],
): Promise<DraftBriefEntryPoint[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select({
      id: briefItems.id,
      ownerUserId: briefItems.ownerUserId,
      sensitivity: briefItems.sensitivity,
    })
    .from(briefItems)
    .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
    .where(
      and(
        eq(briefItems.ownerUserId, ownerUserId),
        eq(briefs.ownerUserId, ownerUserId),
        inArray(briefItems.id, ids),
      ),
    );
}
