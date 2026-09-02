// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";
import { Suggestion } from "./suggestion";

/**
 * The Suggestion chip forwards its `suggestion` string (not its visible label) to
 * `onClick` — the surface acts on the prompt text, not on what the chip reads.
 *
 * This is a DOM test rather than a functional call of the component because the
 * canonical AI Elements source memoizes the handler with `useCallback`, which
 * only runs inside a real render.
 */
describe("AI Elements Suggestion", () => {
  it("calls onClick with the suggestion string when activated", async () => {
    const onClick = vi.fn();
    render(
      <Suggestion onClick={onClick} suggestion="Send Maya the deck">
        Maya
      </Suggestion>,
    );

    const chip = screen.getByRole("button", { name: "Maya" });
    expect(chip.getAttribute("type")).toBe("button");

    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledWith("Send Maya the deck");
  });
});
