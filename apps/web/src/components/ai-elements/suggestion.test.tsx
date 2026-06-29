import { describe, expect, it, vi } from "vitest";
import { Suggestion } from "./suggestion";

/**
 * The Suggestion button forwards its `suggestion` string (not its visible label) to
 * `onClick`. Invoking the returned element's handler functionally avoids needing a
 * DOM, matching the repo's render-test style.
 */
describe("AI Elements Suggestion", () => {
  it("calls onClick with the suggestion string when activated", () => {
    const onClick = vi.fn();
    // Calling the function component returns its <Button> element.
    const element = Suggestion({ suggestion: "Send Maya the deck", onClick, children: "Maya" }) as {
      props: { onClick: () => void; type: string };
    };

    expect(element.props.type).toBe("button");
    element.props.onClick();
    expect(onClick).toHaveBeenCalledWith("Send Maya the deck");
  });
});
