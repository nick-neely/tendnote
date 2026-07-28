import type { TodayShortlistResponse } from "@tendnote/domain/today";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import type { ReversibleMutationAdapter } from "@/lib/reversible-mutation";

export function todaySuppressionAdapter(
  candidateIdentity: string,
  restore: () => Promise<OwnerActionResult<TodayShortlistResponse>>,
): ReversibleMutationAdapter<TodayShortlistResponse> {
  return {
    project: (prior) => ({
      ...prior,
      items: prior.items.filter((item) => item.identity !== candidateIdentity),
    }),
    inverse: () => restore(),
  };
}
