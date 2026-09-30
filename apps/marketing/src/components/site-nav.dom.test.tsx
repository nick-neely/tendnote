// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { primaryNav } from "@/lib/site-links";
import { SiteNav } from "./site-nav";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

afterEach(() => {
  cleanup();
  navigation.pathname = "/";
});

function renderNav() {
  return render(<SiteNav links={primaryNav} signInHref="https://app.tendnote.com/sign-in" />);
}

describe("SiteNav", () => {
  it("links Sign in to the app origin", () => {
    renderNav();
    for (const link of screen.getAllByRole("link", { name: "Sign in", hidden: true })) {
      expect(link.getAttribute("href")).toBe("https://app.tendnote.com/sign-in");
    }
  });

  it("marks the current page", () => {
    navigation.pathname = "/pricing";
    renderNav();
    const current = screen
      .getAllByRole("link", { name: "Pricing", hidden: true })
      .map((link) => link.getAttribute("aria-current"));
    expect(current).toEqual(["page", "page"]);
  });

  it("opens the phone menu from the keyboard and closes it on Escape, returning focus", async () => {
    const user = userEvent.setup();
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel?.classList.contains("hidden")).toBe(false);

    await user.tab();
    await user.keyboard("{Escape}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("closes the phone menu after a navigation", async () => {
    const user = userEvent.setup();
    const { rerender } = renderNav();
    await user.click(screen.getByRole("button", { name: "Menu" }));

    navigation.pathname = "/demo";
    rerender(<SiteNav links={primaryNav} signInHref="https://app.tendnote.com/sign-in" />);
    expect(screen.getByRole("button", { name: "Menu" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});
