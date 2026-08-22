import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { digest, fullSha, PASS, text } from "./contract.mjs";
import { sha256 } from "./secure-fs.mjs";

/**
 * Verify tracked evidence bytes against the candidate commit itself rather
 * than against the working tree, so an uncommitted or later-edited file can
 * never stand in for the evidence a report claims.
 */

const REGULAR_BLOB = /^(100644|100755)\s+blob\s+[0-9a-f]{40}\t/;

function label(entry) {
  return entry?.path ?? entry?.uri ?? "unknown";
}

/** Reject an entry before it reaches git; returns a blocking reason or null. */
function recordProblem(entry, candidateSha) {
  if (!fullSha(entry?.sourceCommit) || entry.sourceCommit !== candidateSha)
    return `Evidence ${label(entry)} is not tied to the candidate.`;
  if (!digest(entry?.sha256)) return `Evidence ${label(entry)} has no SHA-256 digest.`;
  if (!text(entry?.path) && !text(entry?.uri))
    return "Every evidence record needs a repository path or URI.";
  if (!text(entry.path)) return null;
  if (isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes(".."))
    return `Evidence file path is absolute or escapes the repository: ${entry.path}`;
  return null;
}

function blobProblem(cwd, candidateSha, entry) {
  try {
    const treeEntry = execFileSync("git", ["ls-tree", candidateSha, "--", entry.path], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!REGULAR_BLOB.test(treeEntry))
      return `Evidence path is not a regular candidate blob: ${entry.path}`;
    const bytes = execFileSync("git", ["show", `${candidateSha}:${entry.path}`], {
      cwd,
      encoding: null,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (sha256(bytes) !== entry.sha256)
      return `Evidence digest mismatch in candidate blob: ${entry.path}`;
    return null;
  } catch {
    return `Evidence file is not present in candidate commit ${candidateSha}: ${entry.path}`;
  }
}

export function verifyEvidenceFiles({ root = process.cwd(), candidateSha, evidence }) {
  const blockers = [];
  const resolvedRoot = resolve(root);
  const entries = Array.isArray(evidence) ? evidence : [];
  if (entries.length === 0) blockers.push("At least one exact evidence record is required.");
  for (const entry of entries) {
    const problem = recordProblem(entry, candidateSha);
    if (problem) {
      blockers.push(problem);
      continue;
    }
    // A URI-only record has nothing to verify against the candidate tree.
    if (!text(entry?.path)) continue;
    const blobIssue = blobProblem(resolvedRoot, candidateSha, entry);
    if (blobIssue) blockers.push(blobIssue);
  }
  return { status: blockers.length === 0 ? PASS : "blocked", blockers };
}
