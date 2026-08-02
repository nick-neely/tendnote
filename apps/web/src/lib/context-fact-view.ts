import { selfContextFactCategories as selfContextCategoryValues } from "@tendnote/domain/context-fact-categories";
import type { ContextFactView } from "@tendnote/domain/context-facts";
import type { Sensitivity } from "@tendnote/domain/privacy";
import type { OwnerActionResult } from "@/lib/owner-action-result";

export type SelfContextCategory = (typeof selfContextCategoryValues)[number];

const selfContextCategoryLabels: Record<SelfContextCategory, string> = {
  background: "Background",
  work: "Work",
  location: "Location",
  interest: "Interest",
  preference: "Preference",
  constraint: "Constraint",
  other: "Other",
};

export const selfContextCategories = selfContextCategoryValues.map((value) => ({
  value,
  label: selfContextCategoryLabels[value],
}));
export type SelfContextFactMutationResult = OwnerActionResult<ContextFactView>;
export type SelfContextFactDraft = {
  category: SelfContextCategory;
  content: string;
  sensitivity: Sensitivity;
};

const categoryLabelByValue = new Map(
  selfContextCategories.map((category) => [category.value, category.label]),
);

export function contextFactCategoryLabel(category: SelfContextCategory): string {
  return categoryLabelByValue.get(category) ?? "Other";
}

export function contextFactSensitivityLabel(sensitivity: Sensitivity): string {
  if (sensitivity === "sensitive") return "Sensitive";
  if (sensitivity === "restricted") return "Restricted";
  return "Normal";
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
