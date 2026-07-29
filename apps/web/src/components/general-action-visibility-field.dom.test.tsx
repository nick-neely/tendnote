// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";

// Radix's Checkbox measures its control to size the hidden form input; jsdom has
// no layout to observe.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

/**
 * The "Share with" checklist, once its rows are built on the registry Checkbox. A
 * Checkbox is a button, and inside a form Radix also renders a hidden native input
 * that re-dispatches a click. Wrapped in a clickable row label, that pairing is
 * exactly where a stray second toggle would appear, so what these pin is that one
 * click on the row is one change of selection.
 */

import {
  ActionVisibilityField,
  type ShareableActionMember,
} from "./general-action-visibility-field";

const MEMBERS: ShareableActionMember[] = [
  { userId: "user-1", name: "Rosa Marin", email: "rosa@example.com" },
  { userId: "user-2", name: "Theo Marin", email: "theo@example.com" },
];

/** The field lives inside a form at every call site, which is what makes Radix bubble. */
function ShareHarness({ onSelectedChange }: { onSelectedChange: (ids: string[]) => void }) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  return (
    <form>
      <ActionVisibilityField
        members={MEMBERS}
        name="test-visibility"
        onChoiceChange={vi.fn()}
        onSelectedChange={(ids) => {
          setSelectedUserIds(ids);
          onSelectedChange(ids);
        }}
        selectedUserIds={selectedUserIds}
        value="selected_members"
      />
    </form>
  );
}

describe("ActionVisibilityField member checklist", () => {
  it("names each member row so the whole row is the control", () => {
    render(<ShareHarness onSelectedChange={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: /Rosa Marin/ })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: /rosa@example.com/ })).toBeDefined();
  });

  it("adds a member on one click and removes them on the next", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    render(<ShareHarness onSelectedChange={onSelectedChange} />);

    const rosa = screen.getByRole("checkbox", { name: /Rosa Marin/ });
    await user.click(rosa);

    expect(onSelectedChange).toHaveBeenCalledTimes(1);
    expect(onSelectedChange).toHaveBeenLastCalledWith(["user-1"]);
    expect(rosa.getAttribute("data-state")).toBe("checked");

    await user.click(rosa);

    expect(onSelectedChange).toHaveBeenCalledTimes(2);
    expect(onSelectedChange).toHaveBeenLastCalledWith([]);
  });

  it("keeps one click on the row's text to one selection change", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    render(<ShareHarness onSelectedChange={onSelectedChange} />);

    await user.click(screen.getByText("theo@example.com"));

    expect(onSelectedChange).toHaveBeenCalledTimes(1);
    expect(onSelectedChange).toHaveBeenLastCalledWith(["user-2"]);
  });
});
