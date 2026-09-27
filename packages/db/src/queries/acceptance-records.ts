import type { LegalDocument } from "@tendnote/domain/legal-documents";
import { getDb } from "../client";
import { acceptanceRecords } from "../schema";

/**
 * Record that an account accepted these document versions (#613). A version
 * already on record keeps its original accepted-at, so a retried sign-up hook
 * never rewrites when assent happened.
 */
export async function recordAcceptances(input: {
  userId: string;
  documents: readonly Pick<LegalDocument, "key" | "version">[];
}) {
  if (input.documents.length === 0) return;

  await getDb()
    .insert(acceptanceRecords)
    .values(
      input.documents.map((doc) => ({
        userId: input.userId,
        documentKey: doc.key,
        version: doc.version,
      })),
    )
    .onConflictDoNothing();
}
