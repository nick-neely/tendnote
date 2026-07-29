// @vitest-environment jsdom
import { type ComponentProps, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";
import { expectRestrictedGateOpensOnRecordType } from "@/test/global-recall-filters";
import { ThemeProvider } from "./theme-provider";

/**
 * Phone overlay behavior that the shell-level suites cannot see: the Menu's
 * navigation contract, the Appearance control, and what the Search surface says
 * before it has anything to show.
 */

// Next's Link intercepts the click and routes client-side. jsdom has no
// navigation at all, so this double keeps the interception and drops the route.
vi.mock("next/link", () => ({
  default: ({ children, href, onClick, ...props }: ComponentProps<"a">) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

// Radix's Select measures and scrolls its content on open; jsdom implements
// none of that.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
HTMLElement.prototype.scrollIntoView ??= vi.fn();
HTMLElement.prototype.hasPointerCapture ??= vi.fn();
HTMLElement.prototype.releasePointerCapture ??= vi.fn();

import { MenuFlow, SearchFlow } from "./mobile-focused-flows";

function renderMenu(onNavigate = vi.fn(), onClose = vi.fn()) {
  render(
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem>
      <MenuFlow onClose={onClose} onNavigate={onNavigate} />
    </ThemeProvider>,
  );
  return { onClose, onNavigate };
}

function SearchHarness({ search }: { search: ComponentProps<typeof SearchFlow>["search"] }) {
  const [query, setQuery] = useState("");
  return (
    <SearchFlow
      onClose={vi.fn()}
      onNavigate={vi.fn()}
      ownerUserId="owner-1"
      query={query}
      search={search}
      setQuery={setQuery}
    />
  );
}

function personResult() {
  return {
    family: "person" as const,
    canonical: { kind: "person" as const, id: "person-jordan" },
    label: "Jordan Rivera",
    supportingText: "Friend from the climbing gym",
    lifecycle: "active",
    match: { kind: "exact" as const, reason: "Matched a name", excerpt: "Jordan" },
    trust: "identity_reference" as const,
    sensitivity: "normal" as const,
    visibility: null,
    grounding: [{ kind: "person" as const, id: "person-jordan" }],
    href: "/people/person-jordan",
    parent: null,
    details: { displayName: "Jordan Rivera" },
  };
}

function memoryResult({ id = "memory-1", text = "Prefers morning coffee chats" } = {}) {
  return {
    family: "relationship_context" as const,
    canonical: { kind: "memory" as const, id },
    // The shared normalizer heads a memory with the person it is about.
    label: "Jordan Rivera",
    supportingText: text,
    lifecycle: "active",
    match: { kind: "exact" as const, reason: "Matched wording", excerpt: text },
    trust: "confirmed_fact" as const,
    sensitivity: "normal" as const,
    visibility: { choice: "only_me" as const, label: "Only me" },
    grounding: [{ kind: "memory" as const, id }],
    href: `/people/person-jordan#memory-${id}`,
    parent: { kind: "person" as const, id: "person-jordan" },
    details: { contextKind: "memory" as const, personDisplayName: "Jordan Rivera" },
  };
}

describe("MenuFlow", () => {
  /**
   * The regression this locks down: the destination renders *under* the still
   * open overlay, so a menu that does not close on activation looks like a
   * frozen app.
   */
  it("closes the overlay as every destination is activated", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderMenu();

    const destinations = within(
      screen.getByRole("navigation", { name: "Menu destinations" }),
    ).getAllByRole("link");
    expect(destinations.map((link) => link.textContent)).toEqual([
      "People",
      "Actions",
      "Assets",
      "Saved Items",
      "Account",
    ]);

    for (const destination of destinations) {
      await user.click(destination);
    }
    expect(onNavigate).toHaveBeenCalledTimes(destinations.length);
  });

  it("shows the current appearance inline and switches theme without opening a menu", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    renderMenu();

    const appearance = screen.getByRole("radiogroup", { name: "Appearance" });
    const options = within(appearance).getAllByRole("radio");
    expect(options.map((option) => option.textContent)).toEqual(["Light", "Dark", "System"]);
    // The current value is readable without touching anything.
    expect(
      within(appearance).getByRole("radio", { name: "System" }).getAttribute("aria-checked"),
    ).toBe("true");

    await user.click(within(appearance).getByRole("radio", { name: "Dark" }));

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(
      within(appearance).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked"),
    ).toBe("true");
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  it("gives the overlay exactly one heading", () => {
    renderMenu();

    const headings = within(screen.getByRole("dialog", { name: "Menu" })).getAllByRole("heading");
    expect(headings.map((heading) => heading.textContent)).toEqual(["Menu"]);
  });
});

describe("SearchFlow", () => {
  it("teaches what is searchable instead of leaving the surface blank", async () => {
    render(<SearchHarness search={vi.fn()} />);

    expect(await screen.findByText("Search your notebook")).toBeDefined();
    expect(screen.getByText(/people, memories, follow-ups, and assets/)).toBeDefined();
  });

  it("keeps the restricted label a label and moves the reason into helper text", async () => {
    const user = userEvent.setup();
    render(<SearchHarness search={vi.fn()} />);

    await expectRestrictedGateOpensOnRecordType(user);
  });

  it("names both filters and the archived switch", async () => {
    render(<SearchHarness search={vi.fn()} />);

    expect(await screen.findByRole("combobox", { name: "Record type" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Match" })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: "Include archived" })).toBeDefined();
  });

  /**
   * That the phone flow is wired to the shared row rule (`recallResultLines`,
   * whose own suite states it for every family), seen through the DOM the owner
   * reads: recall labels a memory with the person it is about, so this list
   * showed "Jordan Rivera" three times over - the person, and each memory about
   * them - with nothing to tell the rows apart.
   */
  it("leads a memory row with what was remembered, not with the person's name again", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue({
      ok: true,
      view: {
        query: "jordan",
        results: [
          personResult(),
          memoryResult({ id: "memory-1", text: "Prefers morning coffee chats" }),
          memoryResult({ id: "memory-2", text: "Moving to Denver in the spring" }),
        ],
        limitations: [],
        hasMore: false,
      },
    });
    render(<SearchHarness search={search} />);

    await user.type(screen.getByRole("textbox", { name: "Search Tendnote" }), "jordan");

    const exact = within(await screen.findByRole("region", { name: "Exact matches" }));
    const rows = exact.getAllByRole("link");
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Jordan Rivera",
      "Prefers morning coffee chats",
      "Moving to Denver in the spring",
    ]);
    // The person is still on each memory row, as the context line under it.
    expect(within(rows[1] as HTMLElement).getByText("Jordan Rivera")).toBeDefined();
  });
});
