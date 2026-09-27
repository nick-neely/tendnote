/**
 * The hosted launch documents a new account accepts by clickwrap. Each current
 * version is dated and lives in the repository beside the contribution packet,
 * so the version recorded on an Acceptance Record always names text that can be
 * read back from history.
 */
export const LEGAL_DOCUMENT_KEYS = ["terms_of_service", "privacy_policy"] as const;

export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

export type LegalDocument = {
  key: LegalDocumentKey;
  title: string;
  version: string;
  /** The date this version takes effect, `YYYY-MM-DD`. */
  effectiveDate: string;
  /** Repository-relative path of this version's text. */
  path: string;
};

export const CURRENT_LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    key: "terms_of_service",
    title: "Terms of Service",
    version: "0.1",
    effectiveDate: "2026-09-27",
    path: "docs/legal/terms-of-service.md",
  },
  {
    key: "privacy_policy",
    title: "Privacy Policy",
    version: "0.1",
    effectiveDate: "2026-09-27",
    path: "docs/legal/privacy-policy.md",
  },
];

/**
 * What the sign-up form asserts: the document versions it showed, and that the
 * person confirmed they live in the United States and are eighteen or older.
 */
export type ClickwrapAcceptance = {
  documents: Partial<Record<LegalDocumentKey, string>>;
  eligible: boolean;
};

/**
 * The acceptance a sign-up form sends for the versions it showed. Built from
 * the rendered documents rather than the current list, so a tab left open
 * across a new version is refused instead of recorded against unseen text.
 */
export function clickwrapAcceptance(
  documents: readonly Pick<LegalDocument, "key" | "version">[] = CURRENT_LEGAL_DOCUMENTS,
): ClickwrapAcceptance {
  return {
    documents: Object.fromEntries(documents.map((doc) => [doc.key, doc.version])),
    eligible: true,
  };
}

export const CLICKWRAP_REQUIRED_MESSAGE =
  "To create an account, accept the Terms of Service and Privacy Policy and confirm you live in the United States and are 18 or older.";

/**
 * Whether a sign-up carried acceptance of every current document version plus
 * the eligibility statement. A form rendered before a new version was published
 * names a stale version and is refused rather than recorded against text the
 * person never saw.
 */
export function isCurrentClickwrapAcceptance(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const { documents, eligible } = input as { documents?: unknown; eligible?: unknown };
  if (eligible !== true || typeof documents !== "object" || documents === null) return false;
  const accepted = documents as Record<string, unknown>;
  return CURRENT_LEGAL_DOCUMENTS.every((doc) => accepted[doc.key] === doc.version);
}
