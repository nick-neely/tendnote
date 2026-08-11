import type { GlobalRecallResponse } from "@tendnote/domain/global-recall";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/global-recall", () => ({ globalRecallAction: vi.fn() }));
vi.mock("@/app/actions/reminders", () => ({
  clearReminderAction: vi.fn(),
  registerReminderInstallationAction: vi.fn(),
  saveReminderAction: vi.fn(),
  setReminderOptInDecisionAction: vi.fn(),
}));

import { RecallResultSection } from "./mobile-focused-flows";

function result(match: "exact" | "related"): GlobalRecallResponse["results"][number] {
  return {
    family: "saved_item",
    canonical: { kind: "saved_item", id: `saved-${match}` },
    label: `${match} filter note`,
    supportingText: "Filter replacement details",
    lifecycle: "active",
    match: {
      kind: match,
      reason: match === "exact" ? "Matched wording" : "Related by meaning",
      excerpt: "filter",
    },
    trust: "saved_context",
    sensitivity: "normal",
    visibility: { choice: "only_me", label: "Only me" },
    grounding: [{ kind: "source_record", id: `source-${match}` }],
    href: `/saved-items?focus=saved-${match}`,
    parent: null,
    details: { kind: "note" },
  };
}

function selfContextResult(): GlobalRecallResponse["results"][number] {
  return {
    family: "self_context",
    canonical: { kind: "context_fact", id: "context-fact-1" },
    label: "I run a software consultancy.",
    supportingText: "Work",
    lifecycle: "active",
    match: { kind: "exact", reason: "Matched Self Context content", excerpt: "software" },
    trust: "self_context",
    sensitivity: "normal",
    visibility: { choice: "only_me", label: "Only me" },
    grounding: [{ kind: "context_fact", id: "context-fact-1" }],
    href: "/account/about-you#context-fact-context-fact-1",
    parent: null,
    details: {
      content: "I run a software consultancy.",
      category: "work",
      categoryLabel: "Work",
      provenance: { channel: "account", origin: "direct" },
    },
  };
}

/** The same statement, said by the household instead of by the owner. */
function householdContextResult(): GlobalRecallResponse["results"][number] {
  return {
    family: "household_context",
    canonical: { kind: "context_fact", id: "household-fact-1" },
    label: "I run a software consultancy.",
    supportingText: "Composition",
    lifecycle: "active",
    match: { kind: "exact", reason: "Matched Household Context content", excerpt: "software" },
    trust: "household_context",
    sensitivity: "normal",
    visibility: { choice: "whole_household", label: "Whole household" },
    grounding: [{ kind: "context_fact", id: "household-fact-1" }],
    href: "/account/household/context#household-context-fact-household-fact-1",
    parent: null,
    details: {
      content: "I run a software consultancy.",
      category: "composition",
      categoryLabel: "Composition",
      provenance: { channel: "account", origin: "direct" },
    },
  };
}

describe("Global Recall mobile result rows", () => {
  it("renders a flat canonical link with progressive Why disclosure", () => {
    const html = renderToStaticMarkup(
      <RecallResultSection
        expanded={["saved_item:saved-exact"]}
        label="Exact"
        onNavigate={vi.fn()}
        onToggle={vi.fn()}
        results={[result("exact")]}
      />,
    );

    expect(html).toContain('aria-label="Exact matches"');
    expect(html).toContain("exact filter note");
    expect(html).toContain("Only me");
    expect(html).toContain("Matched wording: filter");
    expect(html).not.toContain("source-exact");
  });

  it("labels Related matches separately without overstating them", () => {
    const html = renderToStaticMarkup(
      <RecallResultSection
        expanded={[]}
        label="Related"
        onNavigate={vi.fn()}
        onToggle={vi.fn()}
        results={[result("related")]}
      />,
    );

    expect(html).toContain('aria-label="Related matches"');
    expect(html).toContain("Related");
    expect(html).not.toContain("Related by meaning: filter");
  });

  it("renders the exact Self Context wording and canonical About you correction link", () => {
    const html = renderToStaticMarkup(
      <RecallResultSection
        expanded={[]}
        label="Exact"
        onNavigate={vi.fn()}
        onToggle={vi.fn()}
        results={[selfContextResult()]}
      />,
    );

    expect(html).toContain("I run a software consultancy.");
    expect(html).toContain("Work");
    expect(html).toContain("/account/about-you#context-fact-context-fact-1");
    expect(html).toContain("Only me");
  });

  /**
   * The subjects must not be conflated. Same words, same match strength, same
   * section - so the row has to say on its own face which one it is, and link
   * to the surface where that subject is actually corrected.
   */
  it("renders a Household Context row as the household's, not as a private one", () => {
    const html = renderToStaticMarkup(
      <RecallResultSection
        expanded={[]}
        label="Exact"
        onNavigate={vi.fn()}
        onToggle={vi.fn()}
        // The household row repeats the Self row's exact wording on purpose.
        results={[householdContextResult(), selfContextResult()]}
      />,
    );

    expect(html).toContain("Household Context · Composition");
    expect(html).toContain("/account/household/context#household-context-fact-household-fact-1");
    expect(html).toContain("Whole household");
    expect(html).toContain("/account/about-you#context-fact-context-fact-1");
    expect(html).toContain("Only me");
  });
});
