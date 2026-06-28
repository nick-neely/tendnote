import type { BriefItemKind, BriefWithItems } from "@tendnote/domain";
import { type FollowupDueState, followupDueState } from "@/lib/followup-view";

/**
 * Presentation view of one persisted brief item. Built once server-side from the
 * stored snapshot — the dashboard never recomputes title, reason, or rank from the
 * live relationship agenda (PRD #65, issue #70).
 */
export type BriefItemView = {
  id: string;
  kind: BriefItemKind;
  title: string;
  reason: string;
  personId: string | null;
  personName: string | null;
  dueLabel: string | null;
  dueState: FollowupDueState | null;
  isSensitive: boolean;
  // Suggested follow-ups can be accepted from the brief, promoting the real
  // reminder through the existing review lifecycle (issue #71).
  isSuggestedFollowup: boolean;
};

export type BriefView = {
  id: string;
  cadence: "daily" | "weekly";
  summary: string | null;
  items: BriefItemView[];
};

function dueLabelFor(dueAt: Date): string {
  return dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Maps a persisted brief to its dashboard view, keeping only the items still
 * active — dismissed, snoozed, and acted-on items leave the rail. Rank order from
 * the snapshot is preserved (the store returns items by rank), so the calm
 * ordering is carried without a nagging numbered badge.
 */
export function toBriefView(brief: BriefWithItems, now: Date = new Date()): BriefView {
  const items = brief.items
    .filter((item) => item.status === "active")
    .map((item): BriefItemView => {
      const due = item.dueAt;
      return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        reason: item.reason,
        personId: item.personId,
        personName: item.personDisplayName,
        dueLabel: due ? dueLabelFor(due) : null,
        dueState: due ? followupDueState(due, now) : null,
        isSensitive: item.sensitivity === "sensitive",
        // Mirror the acceptance precondition: a suggested follow-up is acceptable
        // only when it carries the follow-up source ref the accept resolves from.
        isSuggestedFollowup:
          item.kind === "suggested_followup" &&
          item.sourceRefs.some((ref) => ref.kind === "followup"),
      };
    });

  return {
    id: brief.id,
    cadence: brief.cadence,
    summary: brief.summary,
    items,
  };
}
