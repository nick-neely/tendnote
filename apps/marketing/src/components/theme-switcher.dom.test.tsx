// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSwitcher } from "./theme-switcher";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = "";
});

function renderSwitcher() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeSwitcher />
    </ThemeProvider>,
  );
}

describe("ThemeSwitcher", () => {
  it("names the current mode and switches to the one picked", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    const toggle = screen.getByRole("button", { name: "Theme: System" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await user.click(toggle);
    expect(screen.getByRole("radio", { name: "System" })).toHaveProperty("checked", true);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBe(document.activeElement);
  });

  it("moves between modes with the arrow keys and closes on Escape", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: "Theme: System" }));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "System" }));
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveProperty("checked", true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBe(document.activeElement);
  });
});
