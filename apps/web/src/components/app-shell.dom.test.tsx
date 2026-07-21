// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";
import { AppShell } from "./app-shell";

describe("AppShell Phase Seven mobile navigation", () => {
  it("uses exactly the five selected phone destinations and keeps domain links in Menu", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    const mobileNav = screen.getByRole("navigation", { name: "Mobile primary" });
    expect(
      [...mobileNav.querySelectorAll("a, button")].map((item) => item.textContent?.trim()),
    ).toEqual(["Today", "Search", "Capture", "Review", "Menu"]);
    expect(screen.queryByText(/items? to review/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Capture" }).className).toMatch(/font-medium/);
    for (const control of mobileNav.querySelectorAll("a, button")) {
      expect(control.className).toContain("min-h-16");
    }

    await user.click(screen.getByRole("button", { name: "Menu" }));
    for (const name of ["People", "Actions", "Assets", "Saved Items", "Account"]) {
      expect(screen.getByRole("link", { name })).toBeDefined();
    }
  });

  it("marks Review as the active phone destination without adding a count", () => {
    render(
      <AppShell mobileReview ownerUserId="owner-1">
        <p>Review queue</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Review" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens focused flows without the bottom bar and restores invoking focus and surface state", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <input aria-label="Desktop state" defaultValue="still here" />
      </AppShell>,
    );

    const searchButton = screen.getByRole("button", { name: "Search" });
    searchButton.focus();
    await user.click(searchButton);

    expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined();
    expect(screen.queryByRole("navigation", { name: "Mobile primary" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search Tendnote" })).toBe(document.activeElement);
    expect(screen.getByRole("button", { name: "Back to Today" }).className).toContain("size-11");
    expect(screen.getByRole("dialog", { name: "Search" }).className).toContain("h-dvh");

    await user.type(screen.getByRole("textbox", { name: "Search Tendnote" }), "air filter");

    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    await waitFor(() => expect(searchButton).toBe(document.activeElement));
    expect(screen.getByDisplayValue("still here")).toBeDefined();
    await user.click(searchButton);
    expect(screen.getByDisplayValue("air filter")).toBeDefined();
  });

  it("renders the selected shaded Today band and a reserved flat Personal Ledger region", () => {
    const { container } = render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { name: "Today" })).toBeDefined();
    expect(screen.getByTestId("today-orientation-band").className).toContain("bg-panel");
    expect(screen.getByRole("textbox", { name: "Ask Eve anything" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Eve" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Today shortlist" })).toBeDefined();
    expect(container.querySelectorAll("[data-today-ledger-row]")).toHaveLength(3);
  });

  it("keeps the compact Today Eve composer usable before opening the focused flow", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.type(screen.getByRole("textbox", { name: "Ask Eve anything" }), "What is due?");
    await user.click(screen.getByRole("button", { name: "Send to Eve" }));
    expect(screen.getByRole("dialog", { name: "Eve" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    expect(screen.getByDisplayValue("What is due?")).toBeDefined();
  });

  it("restores one visibly unsaved Capture draft, then clears it on discard", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    const input = screen.getByRole("textbox", { name: "What should Tendnote keep?" });
    await user.type(input, "Remember the air filter size");
    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    await user.click(screen.getByRole("button", { name: "Capture" }));

    expect(screen.getByText("Unsaved draft restored on this device.")).toBeDefined();
    expect(screen.getByDisplayValue("Remember the air filter size")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(
      (screen.getByRole("textbox", { name: "What should Tendnote keep?" }) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });

  it("clears the Capture draft only after a successful submission", async () => {
    const user = userEvent.setup();
    render(
      <AppShell mobileHome onCaptureSubmit={async () => undefined} ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Remember the serial number",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByRole("heading", { name: "Capture saved" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    await user.click(screen.getByRole("button", { name: "Capture" }));
    expect(screen.queryByText("Unsaved draft restored on this device.")).toBeNull();
  });
});
