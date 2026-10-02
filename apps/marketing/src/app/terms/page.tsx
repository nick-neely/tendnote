import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { loadLegalDocument } from "@/lib/legal-documents";

export const metadata: Metadata = { title: "Terms of Service" };

export default async function TermsPage() {
  return <LegalDocument document={await loadLegalDocument("terms_of_service")} />;
}
