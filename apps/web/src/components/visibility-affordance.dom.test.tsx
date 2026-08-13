// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";
import { VisibilityControl, VisibilityStatus } from "./visibility-affordance";

describe("VisibilityStatus", () => {
  it("omits a private audience on ordinary ledgers", () => {
    const { container } = render(<VisibilityStatus scope="private" />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Only me")).toBeNull();
  });

  it("keeps an explicit private status when who is included is the point", () => {
    render(<VisibilityStatus privatePolicy="show" scope="private" />);

    const status = screen.getByText("Only me");
    expect(status.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(status.getAttribute("title")).toBeNull();
  });

  it("states a selected-member audience in visible text next to the eye", () => {
    render(<VisibilityStatus scope="shared" selectedCount={2} />);

    const status = screen.getByText("Shared with 2 people");
    expect(status.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("Specific people")).toBeNull();
  });

  it("states whole-household audience as Whole household, never as a household name", () => {
    render(<VisibilityStatus scope="household" />);

    expect(screen.getByText("Whole household")).toBeTruthy();
    expect(screen.queryByText("Home")).toBeNull();
  });
});

describe("VisibilityControl", () => {
  it("names the control in visible text and is reachable from the keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<VisibilityControl onClick={onClick} />);

    const control = screen.getByRole("button", { name: "Visibility" });
    expect(control.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(control.getAttribute("title")).toBeNull();

    await user.tab();
    expect(document.activeElement).toBe(control);
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
