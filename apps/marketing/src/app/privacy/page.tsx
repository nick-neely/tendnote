import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import {
  loadLegalDocument,
  loadRepositoryDocument,
  RETENTION_TABLE_PATH,
  SUB_PROCESSORS_PATH,
} from "@/lib/legal-documents";

export const metadata: Metadata = { title: "Privacy Policy" };

export default async function PrivacyPage() {
  const [policy, retention, subProcessors] = await Promise.all([
    loadLegalDocument("privacy_policy"),
    loadRepositoryDocument(RETENTION_TABLE_PATH),
    loadRepositoryDocument(SUB_PROCESSORS_PATH),
  ]);

  return (
    <LegalDocument document={policy}>
      <LegalSection document={retention} id="retention" title="Retention" />
      <LegalSection document={subProcessors} id="sub-processors" title="Sub-processors" />
    </LegalDocument>
  );
}
