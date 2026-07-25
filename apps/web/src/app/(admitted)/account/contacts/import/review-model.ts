import type {
  ContactImportApplyResult,
  ContactImportPreviewCandidate,
} from "@tendnote/db/queries/contacts-import-preview";

/**
 * The pure decision layer behind the contact import review table.
 *
 * Every question the review surface asks that has an answer independent of React —
 * how the session working set reorders, what an apply result means for the rows the
 * owner just confirmed, and which sentence the owner should read afterwards — is
 * answered here, as a function of values. The client modules above it
 * (`use-contact-import-review`, the table components) hold state, effects, and
 * rendering; they never re-derive an outcome.
 *
 * The deletion test: remove this module and the review surface cannot say what
 * happened to a confirmation — the reconciliation and the wording of every toast
 * live nowhere else. Nothing here imports React or sonner, so all of it is directly
 * exercised by `review-model.test.ts` rather than only through a rendered table.
 */

type Candidate = ContactImportPreviewCandidate;

/**
 * The one canonical phrase for provider drift (fingerprint mismatch). Reused by the
 * toast and the persistent row marker so the concept reads identically.
 */
export const STALE_NOTE = "Changed in Google Contacts since you previewed. Refresh to retry.";

/** Copy shown when the workflow accepted the request but imported nothing. */
export const NOTHING_IMPORTED_NOTE = "No contacts were imported.";

/** Copy shown when the apply call itself failed. */
export const APPLY_FAILED_NOTE = "Couldn't apply that import. Try again.";

/**
 * A toast the review surface should show, described rather than shown. Keeping the
 * outcome a value is what makes the confirm paths testable without a toast runtime;
 * `presentToast` in `review-toasts.ts` is the only thing that turns one into UI.
 */
export type ToastPlan = {
  tone: "success" | "error" | "info";
  message: string;
  description?: string;
};

/** Stable original ordering, so re-added rows land back in place rather than at the end. */
export function orderIndexOf(candidates: readonly Candidate[]): ReadonlyMap<string, number> {
  return new Map(candidates.map((candidate, index) => [candidate.id, index]));
}

export function sortByOrder(
  rows: readonly Candidate[],
  orderIndex: ReadonlyMap<string, number>,
): Candidate[] {
  return [...rows].sort(
    (left, right) => (orderIndex.get(left.id) ?? 0) - (orderIndex.get(right.id) ?? 0),
  );
}

/**
 * Put rows back into the working set at their original positions, ignoring any that
 * are already present. Returns `prev` unchanged when there is nothing to add, so a
 * no-op reinsert cannot churn React state.
 */
export function withReinserted(
  prev: Candidate[],
  rows: readonly Candidate[],
  orderIndex: ReadonlyMap<string, number>,
): Candidate[] {
  const present = new Set(prev.map((row) => row.id));
  const missing = rows.filter((row) => !present.has(row.id));
  return missing.length > 0 ? sortByOrder([...prev, ...missing], orderIndex) : prev;
}

export function withoutRows(prev: readonly Candidate[], ids: readonly string[]): Candidate[] {
  const removed = new Set(ids);
  return prev.filter((row) => !removed.has(row.id));
}

/**
 * Whether a confirm may start: never while another is in flight, and never for an
 * empty selection. The single gate for every confirm path, so "Confirm safe
 * recommendations" with nothing safe left is a no-op rather than an empty apply.
 */
export function canConfirm(busy: boolean, confirmed: readonly Candidate[]): boolean {
  return !busy && confirmed.length > 0;
}

/**
 * What an apply result means for the rows the owner optimistically cleared: which
 * come back, which are drifted, and which genuinely landed.
 */
export type ApplyReconciliation = {
  /** Rows the workflow refused; they must return to the table. */
  notImported: Candidate[];
  /** Refused specifically because provider data drifted after review. */
  staleRowIds: string[];
  /** Rows that actually landed; any stale marker on them is now obsolete. */
  importedRowIds: string[];
};

/**
 * Reconcile honestly against the workflow's own result rather than assuming the
 * optimistic clear was correct.
 */
export function reconcileApply(
  confirmed: readonly Candidate[],
  result: ContactImportApplyResult,
): ApplyReconciliation {
  const notImportedIds = new Set(result.notImported.map((entry) => entry.candidateId));
  return {
    notImported: confirmed.filter((candidate) => notImportedIds.has(candidate.id)),
    staleRowIds: result.notImported
      .filter((entry) => entry.reason === "stale")
      .map((entry) => entry.candidateId),
    importedRowIds: result.candidates.map((entry) => entry.candidateId),
  };
}

/**
 * The persistent drift markers after a reconciliation: imported rows lose theirs,
 * drifted rows gain one, and every other row keeps whatever it had.
 */
export function nextStaleIds(
  prev: ReadonlySet<string>,
  reconciliation: ApplyReconciliation,
): ReadonlySet<string> {
  const next = new Set(prev);
  for (const id of reconciliation.importedRowIds) {
    next.delete(id);
  }
  for (const id of reconciliation.staleRowIds) {
    next.add(id);
  }
  return next;
}

/**
 * Outcome copy for the two single-candidate confirm paths. Drift is surfaced
 * centrally (its own toast plus a persistent row marker), so a stale refusal
 * deliberately produces no per-row message — `null` means "say nothing here".
 */
export function singleConfirmPlan(
  candidate: Candidate,
  result: ContactImportApplyResult,
  notImported: readonly Candidate[],
): ToastPlan | null {
  if (notImported.length > 0 || result.candidates.length === 0) {
    return isStale(result, candidate.id)
      ? null
      : { tone: "error", message: `Couldn't import ${candidate.displayName}.` };
  }
  const [entry] = result.candidates;
  return {
    tone: "success",
    message: entry?.createdPerson
      ? `Added ${candidate.displayName}`
      : `Updated ${candidate.displayName}`,
  };
}

/**
 * Outcome copy for the bulk safe-confirm path. Stale drift gets its own distinct
 * toast, so an all-stale result says nothing extra here and the success toast only
 * ever speaks to what actually landed.
 */
export function bulkConfirmPlan(result: ContactImportApplyResult): ToastPlan | null {
  if (result.importedCount === 0) {
    return result.notImported.some((entry) => entry.reason === "stale")
      ? null
      : { tone: "info", message: NOTHING_IMPORTED_NOTE };
  }
  const detail = bulkConfirmDetail(result);
  return {
    tone: "success",
    message: `Confirmed ${result.importedCount} ${plural(result.importedCount, "contact", "contacts")}`,
    ...(detail ? { description: detail } : {}),
  };
}

function bulkConfirmDetail(result: ContactImportApplyResult): string {
  return [
    result.createdPeople > 0 ? `${result.createdPeople} added` : null,
    result.updatedPeople > 0 ? `${result.updatedPeople} updated` : null,
    result.addedContactMethods > 0
      ? `${result.addedContactMethods} contact ${plural(result.addedContactMethods, "method", "methods")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Whether the workflow refused this candidate because its provider data drifted
 * after the owner reviewed it.
 */
export function isStale(result: ContactImportApplyResult, candidateId: string): boolean {
  return result.notImported.some(
    (entry) => entry.candidateId === candidateId && entry.reason === "stale",
  );
}

/** Review-needed states sort ahead of safe ones so the work surfaces first. */
export function reviewStateOrder(state: Candidate["reviewState"]): number {
  const order: Record<Candidate["reviewState"], number> = {
    conflict: 0,
    ambiguous_duplicate: 1,
    advisory_match: 2,
    individual_review: 3,
    weak_match: 4,
    safe_recommendation: 5,
  };
  return order[state] ?? 9;
}

/** The free-text filter: name, matched person, and every contact method. */
export function matchesQuery(candidate: Candidate, value: unknown): boolean {
  const query = String(value).trim().toLowerCase();
  if (!query) {
    return true;
  }
  return [
    candidate.displayName,
    candidate.matchedPerson?.displayName ?? "",
    ...candidate.emails,
    ...candidate.phones,
  ].some((field) => field.toLowerCase().includes(query));
}

export function primaryContact(candidate: Candidate): string {
  return candidate.emails[0] ?? candidate.phones[0] ?? "No email or phone";
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
