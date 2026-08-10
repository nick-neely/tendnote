// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  resizeMatchMedia,
  screen,
  setMatchMedia,
  userEvent,
  waitFor,
  within,
} from "@/test/dom";
import { expectRestrictedGateOpensOnRecordType } from "@/test/global-recall-filters";
import { householdContextResult, selfContextResult } from "@/test/global-recall-fixtures";
import { ThemeProvider } from "./theme-provider";

/**
 * The desktop command palette: the keystroke that opens it, the command menu it
 * shows before anything is typed, and the recall results that take over once
 * something is.
 *
 * jsdom has no layout, so "desktop" here is `matchMedia` answering yes to the `lg`
 * query that {@link useWideViewport} asks - which is exactly the switch the
 * component gates on, and the reason the narrow case can be asserted at all.
 */

const routerState = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerState.push, refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Radix's Select measures and scrolls its content on open; jsdom implements none
// of that. cmdk scrolls the selected item into view for the same reason.
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

import { SearchPalette } from "./search-palette";

const success = <T,>(view: T) => ({ ok: true as const, view });

function personResult({
  id = "person-maya",
  label = "Maya Chen",
  matchKind = "exact" as const,
} = {}) {
  return {
    family: "person" as const,
    canonical: { kind: "person" as const, id },
    label,
    supportingText: "Friend from the climbing gym",
    lifecycle: "active",
    match: { kind: matchKind, reason: "Matched a name", excerpt: "Maya" },
    trust: "identity_reference" as const,
    sensitivity: "normal" as const,
    visibility: null,
    grounding: [{ kind: "person" as const, id }],
    href: `/people/${id}`,
    parent: null,
    details: { displayName: label },
  };
}

function savedItemResult() {
  return {
    family: "saved_item" as const,
    canonical: { kind: "saved_item" as const, id: "saved-1" },
    label: "Climbing gym membership",
    supportingText: "Renewal notes",
    lifecycle: "active",
    match: { kind: "related" as const, reason: "Related by meaning", excerpt: "gym" },
    trust: "saved_context" as const,
    sensitivity: "normal" as const,
    visibility: { choice: "only_me" as const, label: "Only me" },
    grounding: [{ kind: "saved_item" as const, id: "saved-1" }],
    href: "/saved-items#saved-item-saved-1",
    parent: null,
    details: { kind: "note" as const },
  };
}

function memoryResult({ id = "memory-1", text = "Prefers morning coffee chats" } = {}) {
  return {
    family: "relationship_context" as const,
    canonical: { kind: "memory" as const, id },
    // The shared normalizer heads a memory with the person it is about.
    label: "Maya Chen",
    supportingText: text,
    lifecycle: "active",
    match: { kind: "exact" as const, reason: "Matched wording", excerpt: text },
    trust: "confirmed_fact" as const,
    sensitivity: "normal" as const,
    visibility: { choice: "only_me" as const, label: "Only me" },
    grounding: [{ kind: "memory" as const, id }],
    href: `/people/person-maya#memory-${id}`,
    parent: { kind: "person" as const, id: "person-maya" },
    details: { contextKind: "memory" as const, personDisplayName: "Maya Chen" },
  };
}

function renderPalette(search = vi.fn().mockResolvedValue(success(emptyResponse()))) {
  render(
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem>
      <SearchPalette ownerUserId="owner-search" search={search} />
    </ThemeProvider>,
  );
  return search;
}

function emptyResponse() {
  return { query: "", results: [], limitations: [], hasMore: false };
}

async function openWithHotkey(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Meta>}k{/Meta}");
  return screen.findByRole("dialog");
}

beforeEach(() => {
  routerState.push.mockReset();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  // Desktop width: the palette only mounts and only binds its key above `lg`.
  setMatchMedia(true);
});

describe("SearchPalette", () => {
  it("opens on Cmd+K from anywhere and closes on the same keystroke", async () => {
    const user = userEvent.setup();
    renderPalette();

    expect(screen.queryByRole("dialog")).toBeNull();
    await openWithHotkey(user);
    expect(screen.getByRole("combobox", { name: "Search and commands" })).toBeDefined();

    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens from the quiet header trigger, which names its own shortcut", async () => {
    const user = userEvent.setup();
    renderPalette();

    const trigger = screen.getByRole("button", { name: "Search Tendnote" });
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Meta+K Control+K");
    expect(trigger.textContent).toContain("K");

    await user.click(trigger);
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("teaches itself with three calm groups before anything is typed", async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithHotkey(user);

    for (const heading of ["Quick actions", "Go to", "Appearance"]) {
      expect(screen.getByText(heading)).toBeDefined();
    }
    for (const command of [
      "Capture a note",
      "Add an action",
      "Add an asset",
      "Save an item",
      "People",
      "Assets",
      "Account",
      "Light",
      "Dark",
      "System",
    ]) {
      expect(screen.getByRole("option", { name: new RegExp(`^${command}$`) })).toBeDefined();
    }

    // The trust model: the command menu never sends, drafts, or destroys.
    expect(screen.queryByText(/send|draft|delete|archive|remove/i)).toBeNull();
  });

  it("runs a Go to command and closes", async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithHotkey(user);

    await user.click(screen.getByRole("option", { name: "People" }));

    expect(routerState.push).toHaveBeenCalledWith("/people");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("switches appearance from the palette and marks the current mode", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    renderPalette();
    await openWithHotkey(user);

    expect(screen.getByRole("option", { name: "System" }).getAttribute("data-checked")).toBe(
      "true",
    );
    await user.click(screen.getByRole("option", { name: "Dark" }));

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(window.localStorage.getItem("theme")).toBe("dark");
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  it("searches as the owner types and groups the answer by record family", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(
      success({
        query: "maya",
        results: [personResult(), savedItemResult(), selfContextResult()],
        limitations: [{ source: "calendar", message: "Calendar results are unavailable." }],
        hasMore: false,
      }),
    );
    renderPalette(search);
    await openWithHotkey(user);

    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "maya");
    await waitFor(() => expect(search).toHaveBeenCalled());

    const people = within(await screen.findByRole("group", { name: "People" }));
    expect(people.getByRole("option", { name: /Maya Chen/ })).toBeDefined();
    const saved = within(screen.getByRole("group", { name: "Saved Items" }));
    const savedRow = saved.getByRole("option", { name: /Climbing gym membership/ });
    // Match strength stays visible without splitting the list in two.
    expect(within(savedRow).getByText("Related")).toBeDefined();
    const selfContext = within(screen.getByRole("group", { name: "Self Context" }));
    expect(
      selfContext.getByRole("option", { name: /I run a software consultancy\.Work/ }),
    ).toBeDefined();
    expect(screen.getByText("Calendar results are unavailable.")).toBeDefined();
  });

  /**
   * Two subjects, never one. The palette groups by family, so the household's
   * shared statement has to arrive under its own heading rather than folded in
   * beside what the owner wrote about themselves - even when both are worded
   * the same way, which is what this fixture pair does.
   */
  it("keeps Household Context in its own group rather than under Self Context", async () => {
    const user = userEvent.setup();
    const content = "I run a software consultancy.";
    const search = vi.fn().mockResolvedValue(
      success({
        query: "software",
        results: [selfContextResult(), householdContextResult({ content })],
        limitations: [],
        hasMore: false,
      }),
    );
    renderPalette(search);
    await openWithHotkey(user);

    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "software");
    await waitFor(() => expect(search).toHaveBeenCalled());

    const selfContext = within(await screen.findByRole("group", { name: "Self Context" }));
    const selfRow = selfContext.getByRole("option", { name: /I run a software consultancy\./ });
    expect(selfRow.textContent).toContain("Work");
    expect(selfRow.textContent).not.toContain("Household");

    const household = within(screen.getByRole("group", { name: "Household Context" }));
    expect(
      household.getByRole("option", { name: /Household Context · Composition/ }),
    ).toBeDefined();
  });

  it("offers Household Context as its own record type", async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithHotkey(user);

    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "software");
    await user.click(screen.getByRole("combobox", { name: "Record type" }));

    expect(screen.getByRole("option", { name: "Household Context" })).toBeDefined();
    expect(screen.getByRole("option", { name: "Self Context" })).toBeDefined();
  });

  /**
   * That the palette is wired to the shared row rule (`recallResultLines`, whose
   * own suite states it for every family), seen through the DOM the owner reads:
   * recall labels a memory with the person it is about, so an unguarded palette
   * showed "Maya Chen" under People and "Maya Chen" under Memories - one record,
   * apparently listed twice - with every memory about one person looking like
   * every other.
   */
  it("leads a memory with what was remembered, not with the person's name again", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(
      success({
        query: "maya",
        results: [
          personResult(),
          memoryResult({ id: "memory-1", text: "Prefers morning coffee chats" }),
          memoryResult({ id: "memory-2", text: "Moving to Denver in the spring" }),
        ],
        limitations: [],
        hasMore: false,
      }),
    );
    renderPalette(search);
    await openWithHotkey(user);

    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "maya");

    const memories = within(await screen.findByRole("group", { name: "Memories" }));
    expect(memories.getByRole("option", { name: /^Prefers morning coffee chats/ })).toBeDefined();
    expect(memories.getByRole("option", { name: /^Moving to Denver in the spring/ })).toBeDefined();
    // The person stays as context on the row, and stays the headline under People.
    const people = within(screen.getByRole("group", { name: "People" }));
    expect(people.getByRole("option", { name: /^Maya Chen/ })).toBeDefined();
  });

  it("navigates to the highlighted result on Enter and closes", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(
      success({
        query: "maya",
        results: [personResult(), personResult({ id: "person-mara", label: "Mara Reed" })],
        limitations: [],
        hasMore: false,
      }),
    );
    renderPalette(search);
    await openWithHotkey(user);

    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "maya");
    expect(await screen.findByText("Mara Reed")).toBeDefined();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(routerState.push).toHaveBeenCalledWith("/people/person-mara");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps restricted matches gated until a record type is chosen", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(success(emptyResponse()));
    renderPalette(search);
    await openWithHotkey(user);

    // The filter bar only appears once there is something to narrow.
    expect(screen.queryByRole("checkbox", { name: "Reveal restricted matches" })).toBeNull();

    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "maya");

    await expectRestrictedGateOpensOnRecordType(async () => {
      await user.click(screen.getByRole("combobox", { name: "Record type" }));
      await user.click(await screen.findByRole("option", { name: "People" }));
    });

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ family: "people" })),
    );
  });

  it("says plainly when nothing matched", async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithHotkey(user);

    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "zzzzz nothing");

    expect(await screen.findByText("Nothing matched that search.")).toBeDefined();
  });

  /**
   * A search that never ran is not a search that found nothing. One character is
   * below the seam's floor, so the palette has no answer to report - and calling
   * that "nothing matched" would tell the owner their notebook is empty of
   * something it was never asked about.
   */
  it("does not present an unrun search as an empty result", async () => {
    const user = userEvent.setup();
    const search = vi.fn();
    renderPalette(search);
    await openWithHotkey(user);

    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "z");

    expect(await screen.findByText("Keep typing to search.")).toBeDefined();
    expect(screen.queryByText("Nothing matched that search.")).toBeNull();
    // Nothing to narrow yet either, so the filter bar stays away.
    expect(screen.queryByRole("checkbox", { name: "Reveal restricted matches" })).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  /**
   * Narrowing past `lg` hands recall back to the phone shell, and the palette goes
   * with it. If it went without also being marked closed, widening again would put
   * an open palette back over whatever the owner had moved on to - a dialog nobody
   * asked for, on a surface they were not looking at when they last saw it.
   */
  it("does not reopen itself when the viewport comes back to desktop", async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithHotkey(user);

    resizeMatchMedia(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    resizeMatchMedia(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Search Tendnote" })).toBeTruthy(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    // And it still opens when actually asked.
    await openWithHotkey(user);
  });

  it("reopens onto the command menu rather than the last search", async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithHotkey(user);

    const input = screen.getByRole("combobox", { name: "Search and commands" });
    await user.type(input, "maya");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await openWithHotkey(user);
    expect(
      (screen.getByRole("combobox", { name: "Search and commands" }) as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText("Quick actions")).toBeDefined();
  });

  it("stays out of the way on phones, where the bottom bar owns search", async () => {
    setMatchMedia(false);
    const user = userEvent.setup();
    renderPalette();

    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("{Control>}k{/Control}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("finds a command by intent, not only by its exact wording", async () => {
    const user = userEvent.setup();
    renderPalette();
    await openWithHotkey(user);

    // People and follow-ups are created through capture, so capture answers for
    // them: typing either word has to surface it.
    await user.type(screen.getByRole("combobox", { name: "Search and commands" }), "person");

    const quickActions = within(await screen.findByRole("group", { name: "Quick actions" }));
    expect(quickActions.getByRole("option", { name: "Capture a note" })).toBeDefined();
    expect(quickActions.queryByRole("option", { name: "Add an asset" })).toBeNull();
  });
});
