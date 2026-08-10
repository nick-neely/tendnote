/**
 * The two Context families, worded so a suite can put them side by side.
 *
 * They deliberately share nothing but shape: the whole point of the pair is that
 * a member reading a result can tell a statement they made about themselves from
 * one the household agreed together, so a fixture that generated both from one
 * template would hide exactly the difference these suites exist to check.
 */
export function selfContextResult() {
  return {
    family: "self_context" as const,
    canonical: { kind: "context_fact" as const, id: "context-fact-1" },
    label: "I run a software consultancy.",
    supportingText: "Work",
    lifecycle: "active",
    match: { kind: "exact" as const, reason: "Matched Self Context content", excerpt: "software" },
    trust: "self_context" as const,
    sensitivity: "normal" as const,
    visibility: { choice: "only_me" as const, label: "Only me" },
    grounding: [{ kind: "context_fact" as const, id: "context-fact-1" }],
    href: "/account/about-you#context-fact-context-fact-1",
    parent: null,
    details: {
      content: "I run a software consultancy.",
      category: "work" as const,
      categoryLabel: "Work",
      provenance: { channel: "account" as const, origin: "direct" as const },
    },
  };
}

export function householdContextResult({
  content = "Two adults and one child live here.",
  id = "household-fact-1",
} = {}) {
  return {
    family: "household_context" as const,
    canonical: { kind: "context_fact" as const, id },
    label: content,
    supportingText: "Composition",
    lifecycle: "active",
    match: {
      kind: "exact" as const,
      reason: "Matched Household Context content",
      excerpt: content,
    },
    trust: "household_context" as const,
    sensitivity: "normal" as const,
    visibility: { choice: "whole_household" as const, label: "Whole household" },
    grounding: [{ kind: "context_fact" as const, id }],
    href: `/account/household/context#household-context-fact-${id}`,
    parent: null,
    details: {
      content,
      // Composition is a household-only category; a Self result can never carry it.
      category: "composition" as const,
      categoryLabel: "Composition",
      provenance: { channel: "account" as const, origin: "direct" as const },
    },
  };
}
