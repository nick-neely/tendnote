// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/dom";
import { AppShell } from "./app-shell";

describe("AppShell responsive navigation", () => {
  it("uses separate desktop and fixed mobile navigation without a horizontal strip", () => {
    const { container } = render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    const navigations = screen.getAllByRole("navigation");
    expect(navigations).toHaveLength(2);
    expect(navigations[0]?.className).toMatch(/hidden.*md:flex/);
    expect(navigations[1]?.className).toMatch(/fixed.*bottom-0.*grid.*md:hidden/);
    expect(navigations[1]?.querySelector("a")?.className).toContain(
      "motion-reduce:transition-none",
    );
    expect(container.querySelector("main")?.className).toMatch(/pb-24.*md:pb-6/);
    expect(screen.getAllByRole("link", { name: /assets/i })).toHaveLength(2);
  });
});
