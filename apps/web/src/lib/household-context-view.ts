import type { ContextFactView } from "@tendnote/domain/context-facts";
import type {
  HouseholdContextCategory,
  HouseholdContextReconciliation,
} from "@tendnote/domain/household-context";
import { householdContextCategoryOptions } from "@tendnote/domain/household-context";
import type { Sensitivity } from "@tendnote/domain/privacy";
import type { OwnerActionResult } from "@/lib/owner-action-result";

export type { HouseholdContextReconciliation };

export const householdContextCategories = householdContextCategoryOptions;

/**
 * Sensitivity as this surface explains it.
 *
 * The hints differ from the Self Context ones on purpose: there, the question is
 * how carefully Eve may use a private fact. Here, everyone in the household can
 * read all three levels, so the only thing sensitivity changes is how readily
 * Eve raises it — and saying otherwise would let a member believe "restricted"
 * hides something from the people they live with.
 */
export const householdContextSensitivityOptions: readonly {
  value: Sensitivity;
  label: string;
  hint: string;
}[] = [
  { value: "normal", label: "Normal", hint: "Eve may bring it up when it helps." },
  { value: "sensitive", label: "Sensitive", hint: "Eve uses it carefully, only when relevant." },
  {
    value: "restricted",
    label: "Restricted",
    hint: "Eve raises it only if someone asks directly.",
  },
];

export function householdContextSensitivityHint(sensitivity: Sensitivity): string {
  return (
    householdContextSensitivityOptions.find((option) => option.value === sensitivity)?.hint ?? ""
  );
}

export function householdContextSensitivityLabel(sensitivity: Sensitivity): string {
  return (
    householdContextSensitivityOptions.find((option) => option.value === sensitivity)?.label ?? ""
  );
}

export type HouseholdContextDraftView = {
  category: HouseholdContextCategory;
  content: string;
  sensitivity: Sensitivity;
};

/**
 * The one shape every household write answers with.
 *
 * `stale` rides the success channel rather than the error one because nothing
 * went wrong: the member's draft survived and the next move is theirs. Making it
 * a failure would have forced this surface to rebuild the comparison from a
 * message string.
 */
export type HouseholdContextMutationView =
  | { outcome: "saved"; fact: ContextFactView; decision: string }
  | { outcome: "stale"; reconciliation: HouseholdContextReconciliation };

export type HouseholdContextMutationResult = OwnerActionResult<HouseholdContextMutationView>;

export function isHouseholdContextFact(fact: ContextFactView): boolean {
  return fact.subject.kind === "household";
}
