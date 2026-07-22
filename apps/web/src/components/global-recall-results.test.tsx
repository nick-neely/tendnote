import type { GlobalRecallResponse } from "@tendnote/domain/global-recall";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/global-recall", () => ({ globalRecallAction: vi.fn() }));

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
});
