// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";

/**
 * The people-link chips. Built on the registry Toggle, each chip is a pressed-state
 * button rather than a hidden checkbox, so what matters is that the person's name is
 * still the chip's accessible name and that pressed state tracks the selection.
 */

import { ActionPeopleField } from "./general-action-people-field";

const PEOPLE = [
  { id: "person-1", displayName: "Rosa Marin" },
  { id: "person-2", displayName: "Theo Marin" },
];

describe("ActionPeopleField", () => {
  it("stays out of the way when the owner has no people", () => {
    const { container } = render(
      <ActionPeopleField onChange={vi.fn()} people={[]} selectedIds={[]} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("carries the selection in the chip's pressed state, not color alone", () => {
    render(<ActionPeopleField onChange={vi.fn()} people={PEOPLE} selectedIds={["person-2"]} />);

    expect(screen.getByRole("button", { name: "Rosa Marin" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "Theo Marin" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("links a person on press and unlinks them on the next press", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ActionPeopleField onChange={onChange} people={PEOPLE} selectedIds={["person-2"]} />);

    await user.click(screen.getByRole("button", { name: "Rosa Marin" }));

    expect(onChange).toHaveBeenLastCalledWith(["person-2", "person-1"]);

    await user.click(screen.getByRole("button", { name: "Theo Marin" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
