import type { ContextFactMutationDecision, ContextFactView } from "@tendnote/domain/context-facts";
import {
  contextFactCategoryLabel as domainContextFactCategoryLabel,
  selfContextFactCategories as selfContextCategoryValues,
} from "@tendnote/domain/context-facts";
import type { Sensitivity } from "@tendnote/domain/privacy";
import type { OwnerActionResult } from "@/lib/owner-action-result";

export type SelfContextCategory = (typeof selfContextCategoryValues)[number];

export const selfContextCategories = selfContextCategoryValues.map((value) => ({
  value,
  label: domainContextFactCategoryLabel(value),
}));

/**
 * Sensitivity in the order it escalates, paired with what each level means for
 * how Eve may use the fact. The label stays a single word because it is what a
 * `Select` trigger has room to show; the meaning travels as a separate `hint`
 * that a field can render beside the control instead of truncating inside it.
 */
export const selfContextSensitivityOptions: readonly {
  value: Sensitivity;
  label: string;
  hint: string;
}[] = [
  { value: "normal", label: "Normal", hint: "May help with relevant orientation." },
  { value: "sensitive", label: "Sensitive", hint: "Used carefully, only when relevant." },
  { value: "restricted", label: "Restricted", hint: "Only for a direct, relevant request." },
];

export function contextFactSensitivityHint(sensitivity: Sensitivity): string {
  return selfContextSensitivityOptions.find((option) => option.value === sensitivity)?.hint ?? "";
}

export type SelfContextFactMutationDecision = ContextFactMutationDecision;

export type SelfContextFactMutationView = {
  fact: ContextFactView;
  decision: SelfContextFactMutationDecision;
};

export type SelfContextFactMutationResult = OwnerActionResult<SelfContextFactMutationView>;
export type SelfContextFactDeleteResult = OwnerActionResult<{
  deletedContextFactId: string;
}>;
export type SelfContextFactDraft = {
  category: SelfContextCategory;
  content: string;
  sensitivity: Sensitivity;
};

export function contextFactCategoryLabel(category: SelfContextCategory): string {
  return domainContextFactCategoryLabel(category);
}

export function contextFactSensitivityLabel(sensitivity: Sensitivity): string {
  return selfContextSensitivityOptions.find((option) => option.value === sensitivity)?.label ?? "";
}

export function contextFactProvenanceLabel(fact: ContextFactView): string {
  if (fact.provenance.channel === "onboarding") return "Added during setup";
  if (fact.provenance.channel === "eve") return "Added through Eve";
  if (fact.provenance.channel === "capture") return "Added through Capture";
  if (fact.provenance.channel === "import") return "Imported for review";
  if (fact.provenance.channel === "review") return "Accepted in Review";
  if (fact.provenance.channel === "ambient") return "Suggested from a conversation";
  return "Added in Account";
}

export function formatContextFactDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

export function isActiveSelfContextFact(fact: ContextFactView): boolean {
  return (
    fact.subject.kind === "self" && fact.lifecycle === "active" && fact.category !== "composition"
  );
}

export function isArchivedSelfContextFact(fact: ContextFactView): boolean {
  return (
    fact.subject.kind === "self" && fact.lifecycle === "archived" && fact.category !== "composition"
  );
}

export function isSelfContextFact(fact: ContextFactView): boolean {
  return isActiveSelfContextFact(fact) || isArchivedSelfContextFact(fact);
}
