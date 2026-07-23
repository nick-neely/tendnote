// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";
import { ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

// Radix's dropdown menu measures its content on open; jsdom ships no
// ResizeObserver or scrollIntoView, so stub both (matchMedia is stubbed by
// @/test/dom, which next-themes needs to resolve the system theme).
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

function renderToggle() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

afterEach(() => {
  // next-themes persists the choice; clear it so tests do not leak into each other.
  window.localStorage.clear();
  document.documentElement.classList.remove("light", "dark");
});

describe("ThemeToggle", () => {
  it("names the trigger by the current mode and defaults to System", async () => {
    renderToggle();
    // The accessible name upgrades from the neutral "Theme" to the current mode
    // once mounted — proving the default is System without a hydration read.
    const trigger = await screen.findByRole("button", { name: "Theme: System" });
    expect(trigger).toBeDefined();
  });

  it("offers Light, Dark, and System as labelled, checkable options", async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(await screen.findByRole("button", { name: /^Theme/ }));

    const options = await screen.findAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
    // Never colour alone: each mode carries a visible text label, and the active
    // one is exposed as checked.
    expect(screen.getByRole("menuitemradio", { name: "System" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Dark" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("switches the document class through next-themes when a mode is chosen", async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(await screen.findByRole("button", { name: /^Theme/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Dark" }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(window.localStorage.getItem("theme")).toBe("dark");

    // And back to a light choice removes the class.
    await user.click(await screen.findByRole("button", { name: /^Theme/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Light" }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
    expect(window.localStorage.getItem("theme")).toBe("light");
  });
});
