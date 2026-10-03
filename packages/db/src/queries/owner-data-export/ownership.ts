import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import {
  assets,
  contextFacts,
  fileUploads,
  generalActionAreas,
  generalActions,
  giftPlans,
  people,
  savedItems,
  sourceRecords,
} from "../../schema";

/**
 * Whether the account owns anything an owner export would carry beyond its own
 * account row (#607). These tables are the export's roots; every other exported
 * record, such as a memory, a follow-up, or a draft, hangs off one of them, so
 * it cannot exist without a root row. The pending area offers Export only when
 * this is true.
 */
export async function ownerHasExportableData(ownerUserId: string): Promise<boolean> {
  const db = getDb();
  const owned = await Promise.all([
    db.select({ id: people.id }).from(people).where(eq(people.ownerUserId, ownerUserId)).limit(1),
    db
      .select({ id: sourceRecords.id })
      .from(sourceRecords)
      .where(eq(sourceRecords.ownerUserId, ownerUserId))
      .limit(1),
    db
      .select({ id: contextFacts.id })
      .from(contextFacts)
      .where(and(eq(contextFacts.subjectKind, "self"), eq(contextFacts.subjectUserId, ownerUserId)))
      .limit(1),
    db
      .select({ id: generalActions.id })
      .from(generalActions)
      .where(
        and(
          eq(generalActions.ownerUserId, ownerUserId),
          eq(generalActions.ownership, "member_owned"),
        ),
      )
      .limit(1),
    db
      .select({ id: generalActionAreas.id })
      .from(generalActionAreas)
      .where(eq(generalActionAreas.ownerUserId, ownerUserId))
      .limit(1),
    db
      .select({ id: savedItems.id })
      .from(savedItems)
      .where(and(eq(savedItems.ownerUserId, ownerUserId), eq(savedItems.ownership, "member_owned")))
      .limit(1),
    db
      .select({ id: giftPlans.id })
      .from(giftPlans)
      .where(eq(giftPlans.ownerUserId, ownerUserId))
      .limit(1),
    db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.ownerUserId, ownerUserId), eq(assets.ownership, "member_owned")))
      .limit(1),
    db
      .select({ id: fileUploads.id })
      .from(fileUploads)
      .where(and(eq(fileUploads.ownerUserId, ownerUserId), eq(fileUploads.ready, true)))
      .limit(1),
  ]);
  return owned.some((rows) => rows.length > 0);
}
