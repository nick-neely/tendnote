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

export function isArchivedSelfContextFact(fact: ContextFactView): boolean {
  return (
    fact.subject.kind === "self" && fact.lifecycle === "archived" && fact.category !== "composition"
  );
}

export function isSelfContextFact(fact: ContextFactView): boolean {
  return isActiveSelfContextFact(fact) || isArchivedSelfContextFact(fact);
}
