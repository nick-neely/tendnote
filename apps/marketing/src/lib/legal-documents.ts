import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CURRENT_LEGAL_DOCUMENTS,
  type LegalDocument,
  type LegalDocumentKey,
} from "@tendnote/domain/legal-documents";

/**
 * The legal pages render the repository's own documents, at the versions the
 * registry in `@tendnote/domain/legal-documents` names, so the site shows the
 * same text sign-up records on an Acceptance Record. The files are read at
 * build time; the pages are static.
 */

const REPOSITORY_URL = "https://github.com/nick-neely/tendnote";

/** The repository-relative files the Privacy Policy page renders beside the policy. */
export const RETENTION_TABLE_PATH = "docs/legal/privacy-retention-table.md";
export const SUB_PROCESSORS_PATH = "docs/legal/sub-processors.md";

type Env = Record<string, string | undefined>;

/**
 * The commit links point at: the deployed one, so a reader sees the text as
 * built, the same rule sign-up uses. Locally there is no SHA, so `main`.
 */
export function sourceRef(env: Env = process.env): string {
  return env.VERCEL_GIT_COMMIT_SHA || "main";
}

/** The GitHub page for a repository-relative path at a ref. */
export function sourceUrl(repoPath: string, ref: string = sourceRef()): string {
  return `${REPOSITORY_URL}/blob/${ref}/${repoPath}`;
}

/**
 * Where a link inside a repository document should go on the site. Relative
 * links resolve against the document's own directory, the way GitHub resolves
 * them, and become GitHub URLs at the same ref. Links with a scheme and
 * in-page fragments pass through untouched.
 */
export function resolveDocumentHref(href: string, documentPath: string, ref: string): string {
  if (
    href === "" ||
    href.startsWith("#") ||
    href.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  ) {
    return href;
  }
  const suffixAt = href.search(/[?#]/);
  const target = suffixAt === -1 ? href : href.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? "" : href.slice(suffixAt);
  const resolved = target.startsWith("/")
    ? path.posix.normalize(target.slice(1))
    : path.posix.join(path.posix.dirname(documentPath), target);
  return `${sourceUrl(resolved, ref)}${suffix}`;
}

/**
 * The body of a repository Markdown file as a page renders it: without HTML
 * comments (generator notes) and without its leading `# Title`, because the
 * page sets its own heading for it.
 */
export function documentBody(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .trimStart()
    .replace(/^# [^\n]*\n/, "")
    .trim();
}

/** `2026-09-27` as "September 27, 2026", independent of the build machine's zone. */
export function formatEffectiveDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * The repository root, found by walking up from the working directory. Next
 * builds and Vitest run from `apps/marketing`; the walk keeps that an
 * implementation detail.
 */
function repositoryRoot(): string {
  let dir = process.cwd();
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`No repository root above ${process.cwd()}`);
    }
    dir = parent;
  }
  return dir;
}

export type RepositoryDocument = {
  /** Repository-relative path, which relative links resolve against. */
  path: string;
  /** Markdown body, without its own title. */
  body: string;
};

/**
 * Reads a repository file at build time. The legal pages are prerendered with
 * no revalidation, so nothing reads these files at runtime and the call is kept
 * out of the server trace rather than shipping the repository with it.
 */
export async function loadRepositoryDocument(repoPath: string): Promise<RepositoryDocument> {
  const markdown = await readFile(
    path.join(/* turbopackIgnore: true */ repositoryRoot(), repoPath),
    "utf8",
  );
  return { path: repoPath, body: documentBody(markdown) };
}

export type LoadedLegalDocument = LegalDocument & RepositoryDocument;

/** The current version of a legal document, as the registry names it. */
export async function loadLegalDocument(key: LegalDocumentKey): Promise<LoadedLegalDocument> {
  const document = CURRENT_LEGAL_DOCUMENTS.find((doc) => doc.key === key);
  if (!document) {
    throw new Error(`No current legal document for ${key}`);
  }
  return { ...document, ...(await loadRepositoryDocument(document.path)) };
}
