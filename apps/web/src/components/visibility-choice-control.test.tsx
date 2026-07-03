import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VisibilityChoiceControl } from "./visibility-choice-control";

describe("VisibilityChoiceControl", () => {
  it("renders simple household visibility choices without ACL vocabulary", () => {
    const html = renderToStaticMarkup(
      <VisibilityChoiceControl onChoiceChange={vi.fn()} value="only_me" />,
    );

    expect(html).toContain("Only me");
    expect(html).toContain("Specific people");
    expect(html).toContain("Whole household");
    expect(html).not.toMatch(/ACL|permissions|role/i);
  });
});
