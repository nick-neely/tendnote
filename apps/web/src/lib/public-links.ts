/** Public destinations outside the product: the marketing site and the source repository. */
export const MARKETING_URL = "https://tendnote.com";

const REPOSITORY_URL = "https://github.com/nick-neely/tendnote";

export const SELF_HOSTING_GUIDE_URL = `${REPOSITORY_URL}/blob/main/docs/self-hosting/vercel-operator-runbook.md`;

/**
 * A hosted legal document's text as deployed, which is the version an
 * Acceptance Record names, rather than whatever a later commit on main says.
 */
export function legalDocumentUrl(doc: { path: string }): string {
  const ref = process.env.VERCEL_GIT_COMMIT_SHA || "main";
  return `${REPOSITORY_URL}/blob/${ref}/${doc.path}`;
}
