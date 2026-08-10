// @vitest-environment jsdom
import { type ComponentProps, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { GLOBAL_RECALL_FAMILY_OPTIONS } from "@/lib/use-global-recall";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";
import { expectRestrictedGateOpensOnRecordType } from "@/test/global-recall-filters";
import { householdContextResult, selfContextResult } from "@/test/global-recall-fixtures";
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
  /**
   * The record-type strip *is* the answer to "what can this find?", so the line
   * under it no longer recites the families in prose - it only has to say what
   * the strip cannot, which is what to do next.
   */
  it("shows what is searchable rather than listing it in prose", async () => {
    render(<SearchHarness search={vi.fn()} />);

    // Every family the seam can answer for, Self Context included - so adding one
    // shows up here rather than needing a sentence rewritten to mention it.
    const recordTypes = await screen.findByRole("radiogroup", { name: "Record type" });
    expect(
      within(recordTypes)
        .getAllByRole("radio")
        .map((chip) => chip.textContent),
    ).toEqual(GLOBAL_RECALL_FAMILY_OPTIONS.map((option) => option.label));
    expect(screen.getByText("Type a name or a few words.")).toBeDefined();
    expect(screen.queryByText(/Self Context, memories, follow-ups, and assets/)).toBeNull();
  });

  it("offers restricted matches only once a record type is chosen", async () => {
    const user = userEvent.setup();
    render(<SearchHarness search={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "More filters" }));

    await expectRestrictedGateOpensOnRecordType(async () => {
      await user.click(screen.getByRole("radio", { name: "People" }));
    });
  });

  /**
   * Record type stays on screen because it is the narrowing people reach for;
   * the rarer three fold behind one control, which reports how many of them are
   * on so a narrowed search never looks like an un-narrowed one.
   */
  it("keeps record type in reach and folds the rarer narrowings behind a counted control", async () => {
    const user = userEvent.setup();
    render(<SearchHarness search={vi.fn()} />);

    const moreFilters = await screen.findByRole("button", { name: "More filters" });
    expect(screen.queryByRole("combobox", { name: "Match" })).toBeNull();
    expect(moreFilters.textContent).toBe("");

    await user.click(moreFilters);
    expect(screen.getByRole("combobox", { name: "Match" })).toBeDefined();

    await user.click(screen.getByRole("checkbox", { name: "Include archived" }));
    await waitFor(() => expect(moreFilters.textContent).toBe("1"));
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

  it("keeps Self Context exact, categorized, private, and correction-linked", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue({
      ok: true,
      view: {
        query: "software",
        results: [selfContextResult()],
        limitations: [],
        hasMore: false,
      },
    });
    render(<SearchHarness search={search} />);

    await user.type(screen.getByRole("textbox", { name: "Search Tendnote" }), "software");
    const exact = within(await screen.findByRole("region", { name: "Exact matches" }));
    const link = exact.getByRole("link", { name: /I run a software consultancy\.Work/ });
    expect(link.getAttribute("href")).toBe("/account/about-you#context-fact-context-fact-1");
    expect(link.parentElement?.parentElement?.textContent).toContain("Only me");
  });

  /**
   * This flow groups by match strength, so both statements land under "Exact"
   * with no family heading between them. Identical wording is the hard case and
   * the one the fixtures use: the household row has to name its subject and
   * route to the household's own page, or the two read as one record listed
   * twice with a different privacy setting.
   */
  it("keeps a Household Context match distinct from an identically worded Self one", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue({
      ok: true,
      view: {
        query: "software",
        results: [
          selfContextResult(),
          householdContextResult({ content: "I run a software consultancy." }),
        ],
        limitations: [],
        hasMore: false,
      },
    });
    render(<SearchHarness search={search} />);

    await user.type(screen.getByRole("textbox", { name: "Search Tendnote" }), "software");
    const exact = within(await screen.findByRole("region", { name: "Exact matches" }));

    const household = exact.getByRole("link", {
      name: /I run a software consultancy\.Household Context · Composition/,
    });
    expect(household.getAttribute("href")).toBe(
      "/account/household/context#household-context-fact-household-fact-1",
    );
    expect(household.parentElement?.parentElement?.textContent).toContain("Whole household");
    expect(
      exact.getByRole("link", { name: /I run a software consultancy\.Work/ }).getAttribute("href"),
    ).toBe("/account/about-you#context-fact-context-fact-1");
  });
});
