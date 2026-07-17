import { randomUUID } from "node:crypto";
import {
  type ContactImportImportedCandidate,
  emptyApplyResult,
  importConfirmedCandidate,
  screenConfirmation,
  summarizeApply,
} from "./apply";
import { buildCandidate, normalizedContactMethods } from "./candidate";
import type {
  ContactImportApplyDeps,
  ContactImportApplyResult,
  ContactImportCandidateConfirmation,
  ContactImportNotImportedCandidate,
  ContactImportPreviewCandidate,
  ContactImportPreviewDeps,
  ContactImportPreviewSession,
  GoogleContactsPreviewContact,
} from "./types";

const DEFAULT_PREVIEW_LIMIT = 3;

export async function createContactImportPreviewSession(
  input: { ownerUserId: string; query?: string; limit?: number },
  deps: ContactImportPreviewDeps,
): Promise<ContactImportPreviewSession> {
  const connected = await deps.isProviderCapabilityConnected({
    ownerUserId: input.ownerUserId,
    providerKey: "google",
    capabilityKey: "contacts",
  });
  const query = input.query?.trim() ?? "";
  const mode = query ? "search" : "prioritized";
  const limit = input.limit ?? DEFAULT_PREVIEW_LIMIT;

  if (!connected) {
    return emptySession({ connected: false, mode, query });
  }

  let contacts: GoogleContactsPreviewContact[];
  try {
    contacts = await deps.adapter.fetchContacts({ ownerUserId: input.ownerUserId });
  } catch (error) {
    return {
      ...emptySession({ connected: true, mode, query }),
      errorMessage:
        error instanceof Error
          ? error.message
          : "Google Contacts preview is temporarily unavailable.",
    };
  }

  const candidates = (await buildCandidates(contacts, input.ownerUserId, deps))
    .filter((candidate) => (query ? candidateMatchesSearch(candidate, query) : true))
    .sort(compareCandidates);
  const shown = shownCandidates(candidates, mode, limit);

  return {
    id: randomUUID(),
    connected: true,
    mode,
    query,
    fetchedCount: contacts.length,
    shownCount: shown.length,
    hiddenCount: mode === "search" ? 0 : Math.max(0, candidates.length - shown.length),
    candidates: shown,
  };
}

async function buildCandidates(
  contacts: GoogleContactsPreviewContact[],
  ownerUserId: string,
  deps: ContactImportPreviewDeps,
): Promise<ContactImportPreviewCandidate[]> {
  const people = await deps.searchPeople({ ownerUserId, limit: 200 });
  const methods = contacts.flatMap((contact) => normalizedContactMethods(contact));
  const duplicateMatches = methods.length
    ? await deps.findOwnerContactMethodDuplicates({ ownerUserId, methods })
    : [];
  return Promise.all(
    contacts.map((contact) =>
      buildCandidate({ contact, ownerUserId, people, duplicateMatches, deps }),
    ),
  );
}

/**
 * Search shows every hit; the prioritized preview shows a bounded slice of safe
 * one-click rows alongside a bounded slice of rows needing review, so the safe
 * recommendations are never crowded out by higher-scoring risky ones.
 */
function shownCandidates(
  candidates: ContactImportPreviewCandidate[],
  mode: "prioritized" | "search",
  limit: number,
): ContactImportPreviewCandidate[] {
  if (mode === "search") {
    return candidates;
  }
  return [
    ...candidates.filter((candidate) => candidate.safeBulkEligible).slice(0, limit),
    ...candidates.filter((candidate) => !candidate.safeBulkEligible).slice(0, limit),
  ];
}

function emptySession(input: {
  connected: boolean;
  mode: "prioritized" | "search";
  query: string;
}): ContactImportPreviewSession {
  return {
    id: randomUUID(),
    connected: input.connected,
    mode: input.mode,
    query: input.query,
    fetchedCount: 0,
    shownCount: 0,
    hiddenCount: 0,
    candidates: [],
  };
}

/**
 * The Contact Import Preview workflow's owner-scoped apply seam.
 *
 * Deletion test: removing this module would scatter candidate identity,
 * confirmation eligibility, target and create-person policy, birthday
 * reconciliation, provider-drift protection, ephemeral-row handling, owner-wide
 * deduplication, minimized provenance, and audit behavior across the server
 * action and the review UI. Those policies belong together here, behind one
 * interface, with provider and persistence adapters kept internal.
 *
 * Apply rebuilds the preview from a fresh provider fetch so unconfirmed rows
 * stay ephemeral and every write re-derives from authoritative candidate state.
 * Every confirmation must carry the fingerprint the owner reviewed; apply always
 * checks it, so a drifted provider response is reported as stale (never silently
 * reinterpreted) — the guarantee is owned here, not volunteered by callers.
 */
export async function applyContactImportCandidates(
  input: {
    ownerUserId: string;
    mode?: "safe_bulk" | "explicit";
    confirmations: ContactImportCandidateConfirmation[];
  },
  deps: ContactImportApplyDeps,
): Promise<ContactImportApplyResult> {
  const preview = await createContactImportPreviewSession(
    { ownerUserId: input.ownerUserId, limit: 200 },
    deps,
  );
  if (preview.errorMessage) {
    return emptyApplyResult(preview.errorMessage);
  }
  const mode = input.mode ?? "safe_bulk";
  const candidatesById = new Map(preview.candidates.map((candidate) => [candidate.id, candidate]));
  // Dedupe by candidate id so a repeated confirmation in one request cannot
  // trigger a double write; the last confirmation for an id wins.
  const confirmations = new Map(
    input.confirmations.map((confirmation) => [confirmation.candidateId, confirmation]),
  );

  const imported: ContactImportImportedCandidate[] = [];
  const notImported: ContactImportNotImportedCandidate[] = [];

  for (const [candidateId, confirmation] of confirmations) {
    const candidate = candidatesById.get(candidateId);
    if (!candidate) {
      // Stale or invalid identity: never present in the fresh preview.
      notImported.push({ candidateId, reason: "unknown" });
      continue;
    }
    const refusal = screenConfirmation(candidate, confirmation, mode);
    if (refusal) {
      notImported.push({ candidateId, reason: refusal });
      continue;
    }
    const outcome = await importConfirmedCandidate({
      candidate,
      confirmation,
      ownerUserId: input.ownerUserId,
      deps,
    });
    if ("reason" in outcome) {
      notImported.push({ candidateId, reason: outcome.reason });
      continue;
    }
    imported.push(outcome.imported);
  }

  return summarizeApply(imported, notImported);
}

function candidateMatchesSearch(candidate: ContactImportPreviewCandidate, query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  return [candidate.displayName, candidate.birthday, ...candidate.emails, ...candidate.phones].some(
    (value) => value?.toLowerCase().includes(normalizedQuery),
  );
}

function compareCandidates(
  left: ContactImportPreviewCandidate,
  right: ContactImportPreviewCandidate,
): number {
  const byScore = right.score - left.score;
  if (byScore !== 0) {
    return byScore;
  }
  return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
}
