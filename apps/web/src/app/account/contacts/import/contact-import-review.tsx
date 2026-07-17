"use client";

import type { ContactImportPreviewCandidate } from "@tendnote/db/queries/contacts-import-preview";
import { ReviewFooter, ReviewToolbar } from "./review-controls";
import { ReviewTable } from "./review-table";
import { useContactImportReview } from "./use-contact-import-review";

type Candidate = ContactImportPreviewCandidate;

/**
 * The contact import review surface: one table over every fetched candidate, with a
 * toolbar above it and paging below.
 *
 * This component only arranges. All of its behavior — the session working set, drift
 * markers, and every confirm/skip path — comes from {@link useContactImportReview},
 * and the copy and reconciliation behind those paths come from `review-model`.
 */
export function ContactImportReview({
  candidates,
  fetchedCount,
}: {
  candidates: Candidate[];
  fetchedCount: number;
}) {
  const review = useContactImportReview(candidates);

  if (review.data.length === 0) {
    return (
      <EmptyState>
        {fetchedCount === 0
          ? "No contacts were fetched from Google."
          : "Every fetched contact has been handled for this session."}
      </EmptyState>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <ReviewToolbar
        bulkCount={review.bulkTargets.length}
        busy={review.busy}
        globalFilter={review.globalFilter}
        onConfirmSafeBulk={review.confirmSafeBulk}
        onGlobalFilterChange={review.setGlobalFilter}
        table={review.table}
      />
      <ReviewTable
        busy={review.busy}
        onApply={review.applyResolution}
        onSkip={review.skipRow}
        removingIds={review.removingIds}
        table={review.table}
      />
      <ReviewFooter
        fetchedCount={fetchedCount}
        table={review.table}
        totalCount={review.data.length}
      />
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-dashed bg-surface px-3.5 py-6 text-center">
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-muted-foreground">
        {children}
      </p>
    </section>
  );
}
