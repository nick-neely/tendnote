// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/dom";
import { RouteReserve } from "./route-reserve";

describe("RouteReserve", () => {
  it("derives a ledger heading and shape from the destination module", () => {
    const { container } = render(<RouteReserve destination="saved-items" />);

    expect(screen.getByRole("heading", { name: "Saved Items" })).toBeDefined();
    expect(container.firstElementChild?.getAttribute("data-reserve-shape")).toBe("ledger");
  });

  it("derives a detail heading and shape from the destination module", () => {
    const { container } = render(<RouteReserve destination="person" />);

    expect(screen.getByRole("heading", { name: "Person" })).toBeDefined();
    expect(container.firstElementChild?.getAttribute("data-reserve-shape")).toBe("detail");
  });
});
