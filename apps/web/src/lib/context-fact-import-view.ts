import type { ContextFactImportSummary } from "@tendnote/db/queries/context-fact-imports";
import type {
  ContextFactImportProviderId,
  ContextFactImportSource,
} from "@tendnote/domain/context-fact-import";
import { contextFactImportProvider } from "@tendnote/domain/context-fact-import";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import type { SuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";

export type ImportSelfContextFactsActionInput = {
  provider: ContextFactImportProviderId;
  text: string;
};

export type SelfContextImportView = {
  summary: ContextFactImportSummary;
  reviews: SuggestedContextFactReviewView[];
};

export type SelfContextImportResult = OwnerActionResult<SelfContextImportView>;

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * The one line that tells the owner what an import did. It leads with what is
 * waiting for them, stays plain, and never scolds an import that found nothing.
 */
export function contextFactImportHeadline(summary: ContextFactImportSummary): string {
  const providerName = contextFactImportProvider(summary.provider).name;
  if (summary.suggestedCount > 0) {
    return `${plural(summary.suggestedCount, "fact")} from ${providerName} to review.`;
  }
  if (summary.alreadyPendingCount > 0) {
    return `${plural(summary.alreadyPendingCount, "fact")} from ${providerName} ${
      summary.alreadyPendingCount === 1 ? "was" : "were"
    } already waiting for you.`;
  }
  return `Nothing new from ${providerName} this time.`;
}

/**
 * The quiet notes under the headline. Each one exists because the owner would
 * otherwise be left wondering where part of their paste went.
 */
export function contextFactImportNotes(summary: ContextFactImportSummary): string[] {
  const notes: string[] = [];

  if (summary.suggestedCount > 0 && summary.alreadyPendingCount > 0) {
    notes.push(
      `${plural(summary.alreadyPendingCount, "other fact")} ${
        summary.alreadyPendingCount === 1 ? "was" : "were"
      } already waiting for you.`,
    );
  }
  if (summary.skippedCount > 0) {
    notes.push(`${plural(summary.skippedCount, "fact")} you dismissed before stayed dismissed.`);
  }
  if (summary.unreadableCount > 0) {
    notes.push(
      `${plural(summary.unreadableCount, "line")} could not be read as a fact and ${
        summary.unreadableCount === 1 ? "was" : "were"
      } left out.`,
    );
  }

  return notes;
}

/** Where the reading happened. A paste that never reached a model should say so. */
export function contextFactImportSourceNote(source: ContextFactImportSource): string {
  return source === "block"
    ? "Read inside Tendnote. Your paste never left your notebook."
    : "The paste had no Tendnote block, so Tendnote read it with its extraction model.";
}

/** What the owner does next when an import finds nothing at all. */
export function contextFactImportEmptyHint(source: ContextFactImportSource): string {
  return source === "block"
    ? "The block came through, but none of its lines described a durable fact. You can still add one yourself."
    : "Ask the assistant again and hold it to the code block the prompt asks for, or add a fact yourself.";
}
