import { type AdmissionEnvironment, parseAdmissionPolicy } from "@tendnote/domain/admission";
import {
  CURRENT_LEGAL_DOCUMENTS,
  type LegalDocument,
  outstandingReacceptance,
} from "@tendnote/domain/legal-documents";
import { and, eq, inArray } from "drizzle-orm";
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

/**
 * The flagged current document versions a hosted account has not yet accepted
 * (#614): non-empty means the re-acceptance gate stands in front of the app.
 * It costs no read unless a current version is flagged, and a self-hosted
 * deployment owes nothing, because the hosted documents are not its operator's.
 */
export async function listOutstandingReacceptance(input: {
  userId: string;
  documents?: readonly LegalDocument[];
  env?: AdmissionEnvironment;
}): Promise<LegalDocument[]> {
  const documents = input.documents ?? CURRENT_LEGAL_DOCUMENTS;
  const flagged = documents.filter((doc) => doc.reacceptance);
  if (flagged.length === 0 || parseAdmissionPolicy(input.env).mode !== "hosted") return [];

  const accepted = await getDb()
    .select({ documentKey: acceptanceRecords.documentKey, version: acceptanceRecords.version })
    .from(acceptanceRecords)
    .where(
      and(
        eq(acceptanceRecords.userId, input.userId),
        inArray(
          acceptanceRecords.documentKey,
          flagged.map((doc) => doc.key),
        ),
      ),
    );
  return outstandingReacceptance(accepted, flagged);
}
