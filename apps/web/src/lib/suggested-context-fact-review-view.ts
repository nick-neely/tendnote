import type { SuggestedContextFactReviewResult } from "@tendnote/db/queries/context-facts";
import { type ContextFactView, toContextFactView } from "@tendnote/domain/context-facts";

export type SuggestedContextFactReviewView = {
  fact: ContextFactView;
  evidence: string;
  activeMatch: {
    kind: "duplicate" | "conflict";
    fact: ContextFactView;
  } | null;
};

export function toSuggestedContextFactReviewView(
  result: SuggestedContextFactReviewResult,
): SuggestedContextFactReviewView {
  return {
    fact: toContextFactView(result.fact),
    evidence: result.evidence,
    activeMatch: result.activeMatch
      ? {
          kind: result.activeMatch.kind,
          fact: toContextFactView(result.activeMatch.fact),
        }
      : null,
  };
}
