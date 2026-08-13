import type { HouseholdEventPlan } from "@tendnote/domain/household-event-plans";
import type { HouseholdEventPlanResult } from "@/app/actions/household-event-plans";
import {
  buildHouseholdEventPlanConflictView,
  type HouseholdEventPlanConflictView,
  type HouseholdEventPlanRecord,
} from "@/lib/household/household-event-plan-view";

type ResolvedHouseholdEventPlanResult =
  | { outcome: "error"; message: string }
  | {
      outcome: "conflict";
      conflict: HouseholdEventPlanConflictView;
      current: HouseholdEventPlan;
      message: string;
    }
  | { outcome: "saved"; plans: HouseholdEventPlanRecord[] };

type HouseholdEventPlanResultHandlers = {
  onError: (message: string) => void;
  onConflict: (result: Extract<ResolvedHouseholdEventPlanResult, { outcome: "conflict" }>) => void;
  onSaved: (plans: HouseholdEventPlanRecord[]) => void;
};

/** Turns the action wire result into the three UI states every Plan write shares. */
export function handleHouseholdEventPlanResult(
  result: HouseholdEventPlanResult,
  input: { viewerUserId: string; memberNames: ReadonlyMap<string, string> },
  handlers: HouseholdEventPlanResultHandlers,
) {
  if (!result.ok) {
    handlers.onError(result.error);
    return;
  }
  if (result.view.outcome === "saved") {
    handlers.onSaved(result.view.plans);
    return;
  }
  handlers.onConflict({
    outcome: "conflict",
    conflict: buildHouseholdEventPlanConflictView({
      current: result.view.current,
      viewerUserId: input.viewerUserId,
      memberNames: input.memberNames,
    }),
    current: result.view.current,
    message: result.view.message,
  });
}
