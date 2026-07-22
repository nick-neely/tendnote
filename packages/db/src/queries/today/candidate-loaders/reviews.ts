import type { TodayCandidate } from "@tendnote/domain";
import type { TodayCandidateLoaderDeps } from "../candidate-loaders";
import type { TodayCandidateLoader } from "../types";
import { formatDateInZone } from "./shared";

export async function loadAdditionalReviewCandidates(
  deps: TodayCandidateLoaderDeps,
  input: Parameters<TodayCandidateLoader>[0],
): Promise<TodayCandidate[]> {
  const reviews = await deps.listAdditionalReviews({ ownerUserId: input.ownerUserId, limit: 12 });
  return reviews
    .filter((review) => review.sensitivity !== "restricted")
    .map((review) => ({
      identity: `review:${review.id}`,
      family: "review" as const,
      record: { kind: "review_item" as const, id: review.id, href: review.href },
      title: review.title,
      context: "Review Queue",
      reason: {
        code: "awaiting_review" as const,
        key: `review:${review.id}:${review.createdAt.toISOString()}`,
        explanation: `Waiting for review since ${formatDateInZone(review.createdAt, input.timeZone)}.`,
      },
      sourceRefs: review.sourceRefs,
      action: { kind: "open_review" as const, label: "Review", href: "/?tab=review" },
      mandatory: false,
      dueAt: null,
      createdAt: review.createdAt,
      sensitivity: review.sensitivity,
    }));
}
