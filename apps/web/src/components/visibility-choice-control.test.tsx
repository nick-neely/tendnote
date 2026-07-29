import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VisibilityChoiceControl } from "./visibility-choice-control";

/** Only what a person reads. ARIA plumbing (`role="radiogroup"`) is not vocabulary. */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

describe("VisibilityChoiceControl", () => {
  it("renders simple household visibility choices without ACL vocabulary", () => {
    const html = renderToStaticMarkup(
      <VisibilityChoiceControl onChoiceChange={vi.fn()} value="only_me" />,
    );

    expect(html).toContain("Only me");
    expect(html).toContain("Specific people");
    expect(html).toContain("Whole household");
    expect(visibleText(html)).not.toMatch(/ACL|permissions|role/i);
  });

  it("still posts the selected choice under the field name, for plain form call sites", () => {
    const html = renderToStaticMarkup(
      <VisibilityChoiceControl name="memoryVisibility" onChoiceChange={vi.fn()} value="only_me" />,
    );

    // The radios are buttons now, so the value rides Radix's hidden mirror input.
    expect(html).toMatch(/<input[^>]*name="memoryVisibility"[^>]*value="only_me"/);
    expect(html).toMatch(/<input[^>]*name="memoryVisibility"[^>]*checked=""/);
  });
});
