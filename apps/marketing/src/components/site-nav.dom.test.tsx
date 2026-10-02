// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("marks the current page, inline and in the phone menu", async () => {
    const user = userEvent.setup();
    navigation.pathname = "/pricing";
    renderNav();
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("aria-current")).toBe("page");

    await user.click(screen.getByRole("button", { name: "Menu" }));
    const sheet = screen.getByRole("dialog", { name: "Menu" });
    expect(within(sheet).getByRole("link", { name: "Pricing" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("opens the phone menu as a sheet with every page, appearance, and Sign in", async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole("button", { name: "Menu" }));

    const sheet = screen.getByRole("dialog", { name: "Menu" });
    expect(
      within(sheet)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([...primaryNav.map((link) => link.label), "Sign in"]);
    expect(within(sheet).getByRole("group", { name: "Appearance" })).toBeTruthy();
  });

  it("closes the sheet on Escape and returns focus to Menu", async () => {
    const user = userEvent.setup();
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("closes the sheet after a navigation", async () => {
    const user = userEvent.setup();
    const { rerender } = renderNav();
    await user.click(screen.getByRole("button", { name: "Menu" }));

    navigation.pathname = "/demo";
    rerender(<SiteNav links={primaryNav} signInHref="https://app.tendnote.com/sign-in" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
