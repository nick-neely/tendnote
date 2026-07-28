import {
  archiveFollowupAction,
  completeFollowupAction,
  dismissFollowupAction,
  reopenFollowupAction,
  restoreArchivedFollowupAction,
} from "@/app/actions/followups";
import type { FollowupView } from "@/lib/followup-view";
import type { ReversibleMutationAdapter } from "@/lib/reversible-mutation";

type FollowupLifecycleIntent = "archive" | "complete" | "dismiss" | "reopen";

export function followupLifecycleAdapter<TView extends FollowupView = FollowupView>(
  intent: FollowupLifecycleIntent,
): ReversibleMutationAdapter<TView> {
  return {
    project: (prior) =>
      intent === "reopen" ? { ...prior, status: "open", surfaceLabel: "Reopening…" } : prior,
    inverse: async (prior) => {
      const result =
        intent === "archive"
          ? restoreArchivedFollowupAction({ followupId: prior.id })
          : intent !== "reopen"
            ? reopenFollowupAction({ followupId: prior.id })
            : prior.status === "dismissed"
              ? dismissFollowupAction({ followupId: prior.id })
              : prior.status === "completed"
                ? completeFollowupAction({ followupId: prior.id })
                : archiveFollowupAction({ followupId: prior.id });
      const settled = await result;
      return settled.ok ? { ok: true, view: { ...prior, ...settled.view } as TView } : settled;
    },
  };
}
