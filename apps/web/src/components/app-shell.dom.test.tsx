// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";

const navigationState = vi.hoisted(() => ({
  pathname: "/",
  searchParams: new URLSearchParams(),
  sessionOwnerUserId: "owner-1",
}));

vi.mock("@/app/actions/conversational-capture", () => ({
  addCapturePersonAction: vi.fn(),
  captureExplicitOutcomeAction: vi.fn(),
  changeExplicitCaptureOutcomeAction: vi.fn(),
  changeExplicitCaptureReminderAction: vi.fn(),
  undoExplicitCaptureOutcomeAction: vi.fn(),
}));
vi.mock("@/app/actions/reminders", () => ({
  reconcileReminderTimeZoneAction: vi.fn().mockResolvedValue({ reconciled: 0 }),
}));
vi.mock("@/app/actions/global-recall", () => ({
  globalRecallAction: vi.fn().mockResolvedValue({
    query: "",
    results: [],
    limitations: [],
    hasMore: false,
  }),
}));
vi.mock("@/app/actions/today", () => ({
  actOnTodayItemAction: vi.fn(),
  refreshTodayAction: vi.fn().mockResolvedValue({
    items: [],
    candidateFingerprint: "",
    curation: "deterministic",
    overflow: null,
    limitations: [],
  }),
  suppressTodayItemAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => navigationState.searchParams,
}));
vi.mock("@/lib/auth/client", () => ({
  useSession: () => ({
    data: navigationState.sessionOwnerUserId
      ? { user: { id: navigationState.sessionOwnerUserId } }
      : null,
  }),
}));

import { AppShell } from "./app-shell";
import { AppShellEffects } from "./app-shell-effects";
import { MobileHomeReserve } from "./mobile-home-reserve";

beforeEach(() => {
  navigationState.pathname = "/";
  navigationState.searchParams = new URLSearchParams();
  navigationState.sessionOwnerUserId = "owner-1";
  sessionStorage.clear();
});

/**
 * Saves the open capture, reopens it via Change, and hands back the emptied
 * correction textarea, which is where every correction assertion starts.
 */
async function reopenCaptureForCorrection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Save capture" }));
  await user.click(await screen.findByRole("button", { name: "Change" }));
  const correction = screen.getByRole("textbox", { name: "Rewrite what Tendnote saved" });
  await user.clear(correction);
  return correction;
}

describe("AppShell Phase Seven mobile navigation", () => {
  it("names the exact Today or Review destination in the route-aware reserve", () => {
    const view = render(<MobileHomeReserve />);
    expect(screen.getByRole("heading", { name: "Today" })).toBeDefined();

    navigationState.searchParams = new URLSearchParams("tab=review");
    view.rerender(<MobileHomeReserve />);
    expect(screen.getByRole("heading", { name: "Review" })).toBeDefined();
  });

  /**
   * The shell used to resolve the destination from the URL to decide whether the
   * page canvas was padded, which meant suspending `<main>` on `useSearchParams`
   * and rendering `children` in both the fallback and the resolved branch. Two
   * `<main>` elements reached the document, the route painted twice in two
   * different containers, and the swap between them was the visible first-paint
   * jump. One `<main>`, and the destination opting in to its own canvas, is the
   * invariant that keeps it fixed.
   */
  it("renders the route into exactly one main, unpadded only when the destination asks", () => {
    render(
      <AppShell ownerUserId="owner-1" routeAwareMobileNavigation>
        <div data-mobile-bleed>
          <p>Destination</p>
        </div>
      </AppShell>,
    );

    const mains = document.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    expect(screen.getAllByText("Destination")).toHaveLength(1);
    expect(mains[0]?.firstElementChild?.hasAttribute("data-mobile-bleed")).toBe(true);
  });

  it("updates route-aware Today and Review state without remounting the frame", () => {
    const view = render(
      <AppShell ownerUserId="owner-1" routeAwareMobileNavigation>
        <p>Destination</p>
      </AppShell>,
    );

    let mobileNav = within(screen.getByRole("navigation", { name: "Mobile primary" }));
    expect(mobileNav.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBe(
      "page",
    );
    navigationState.searchParams = new URLSearchParams("tab=review");
    view.rerender(
      <AppShell ownerUserId="owner-1" routeAwareMobileNavigation>
        <p>Destination</p>
      </AppShell>,
    );
    mobileNav = within(screen.getByRole("navigation", { name: "Mobile primary" }));
    expect(mobileNav.getByRole("link", { name: "Review" }).getAttribute("aria-current")).toBe(
      "page",
    );

    navigationState.pathname = "/people";
    navigationState.searchParams = new URLSearchParams();
    view.rerender(
      <AppShell ownerUserId="owner-1" routeAwareMobileNavigation>
        <p>Destination</p>
      </AppShell>,
    );
    mobileNav = within(screen.getByRole("navigation", { name: "Mobile primary" }));
    expect(mobileNav.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBeNull();
    expect(mobileNav.getByRole("link", { name: "Review" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getAllByRole("navigation", { name: "Mobile primary" })).toHaveLength(1);
  });

  it("remounts owner-keyed mobile flow state when the admitted session rotates", async () => {
    const user = userEvent.setup();
    const view = render(
      <AppShell routeAwareMobileNavigation>
        <p>Destination</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(
      await screen.findByRole("textbox", { name: "Search Tendnote" }),
      "Owner A private query",
    );
    await user.click(screen.getByRole("button", { name: "Close" }));

    navigationState.sessionOwnerUserId = "owner-2";
    view.rerender(
      <AppShell routeAwareMobileNavigation>
        <p>Destination</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(
      (await screen.findByRole("textbox", { name: "Search Tendnote" })) as HTMLInputElement,
    ).toHaveProperty("value", "");
  });

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

    const mobileNav = within(screen.getByRole("navigation", { name: "Mobile primary" }));
    expect(mobileNav.getByRole("link", { name: "Review" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(mobileNav.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBeNull();
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

    expect(await screen.findByRole("dialog", { name: "Search" })).toBeDefined();
    expect(screen.queryByRole("navigation", { name: "Mobile primary" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search Tendnote" })).toBe(document.activeElement);
    expect(screen.getByRole("button", { name: "Close" }).className).toContain("size-11");
    expect(screen.getByRole("dialog", { name: "Search" }).className).toContain("h-dvh");

    await user.type(screen.getByRole("textbox", { name: "Search Tendnote" }), "air filter");

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(searchButton).toBe(document.activeElement));
    expect(screen.getByDisplayValue("still here")).toBeDefined();
    await user.click(searchButton);
    expect(screen.getByDisplayValue("air filter")).toBeDefined();
  });

  it("renders typed Exact and Related Global Recall results with filters and honest limitations", async () => {
    const user = userEvent.setup();
    const searchHandler = vi.fn().mockResolvedValue({
      query: "fridge filter",
      results: [
        {
          family: "asset_memory",
          canonical: { kind: "asset_memory", id: "memory-1" },
          label: "Filter size",
          supportingText: "RPWFE",
          lifecycle: "active",
          match: { kind: "exact", reason: "Matched an exact Asset value", excerpt: "RPWFE" },
          trust: "asset_fact",
          sensitivity: "normal",
          visibility: { choice: "only_me", label: "Only me" },
          grounding: [{ kind: "asset_memory", id: "memory-1" }],
          href: "/assets/asset-1#asset-memory-memory-1",
          parent: { kind: "asset", id: "asset-1" },
          details: {
            assetId: "asset-1",
            assetName: "Fridge",
            assetKind: "appliance",
            value: { type: "text", text: "RPWFE" },
          },
        },
        {
          family: "saved_item",
          canonical: { kind: "saved_item", id: "saved-1" },
          label: "Filter notes",
          supportingText: "Replacement notes",
          lifecycle: "active",
          match: { kind: "related", reason: "Related by meaning", excerpt: "replacement" },
          trust: "saved_context",
          sensitivity: "normal",
          visibility: { choice: "only_me", label: "Only me" },
          grounding: [{ kind: "saved_item", id: "saved-1" }],
          href: "/saved-items#saved-item-saved-1",
          parent: null,
          details: { kind: "note" },
        },
      ],
      limitations: [{ source: "calendar", message: "Calendar results are unavailable." }],
      hasMore: false,
    });
    render(
      <AppShell mobileHome ownerUserId="owner-search" searchHandler={searchHandler}>
        <p>Today</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByRole("textbox", { name: "Search Tendnote" }), "fridge filter");
    await waitFor(() => expect(searchHandler).toHaveBeenCalled());

    expect(screen.getByRole("region", { name: "Exact matches" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Related matches" })).toBeDefined();
    expect(screen.getByText("Calendar results are unavailable.")).toBeDefined();
    await user.click(screen.getAllByRole("button", { name: "Why this result?" })[0] as HTMLElement);
    expect(screen.getByText(/Matched an exact Asset value/)).toBeDefined();

    await user.selectOptions(screen.getByLabelText("Record type"), "assets");
    await waitFor(() =>
      expect(searchHandler).toHaveBeenLastCalledWith(expect.objectContaining({ family: "assets" })),
    );
  });

  it("reopens Search on browser return and restores the focused result", async () => {
    const storageKey = "tendnote:global-recall:owner-return";
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        query: "filter note",
        family: "saved_items",
        matchKind: "exact",
        includeArchived: true,
        includeRestricted: false,
        expanded: ["saved_item:saved-return"],
        focusedKey: "saved_item:saved-return",
        restoreFocus: true,
        scrollTop: 24,
      }),
    );
    window.history.replaceState(
      {
        tendnoteGlobalRecallOwner: "owner-return",
        tendnoteGlobalRecallReturnUrl: window.location.href,
      },
      "",
      window.location.href,
    );
    const searchHandler = vi.fn().mockResolvedValue({
      query: "filter note",
      results: [
        {
          family: "saved_item",
          canonical: { kind: "saved_item", id: "saved-return" },
          label: "Filter note",
          supportingText: "Replacement details",
          lifecycle: "active",
          match: { kind: "exact", reason: "Matched wording", excerpt: "filter" },
          trust: "saved_context",
          sensitivity: "normal",
          visibility: { choice: "only_me", label: "Only me" },
          grounding: [{ kind: "saved_item", id: "saved-return" }],
          href: "/saved-items#saved-item-saved-return",
          parent: null,
          details: { kind: "note" },
        },
      ],
      limitations: [],
      hasMore: false,
    });

    render(
      <AppShell mobileHome ownerUserId="owner-return" searchHandler={searchHandler}>
        <p>Today</p>
      </AppShell>,
    );

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined());
    await waitFor(() => expect(searchHandler).toHaveBeenCalled());
    const resultLink = await screen.findByRole("link", { name: /Filter note/ });
    await waitFor(() => expect(document.activeElement).toBe(resultLink));
    expect((screen.getByLabelText("Record type") as HTMLSelectElement).value).toBe("saved_items");
    expect(screen.getByText(/Matched wording: filter/)).toBeDefined();

    sessionStorage.removeItem(storageKey);
    window.history.replaceState({}, "", window.location.href);
  });

  it("closes Search and reveals a canonical result on same-route hash navigation", async () => {
    window.history.replaceState({}, "", "/saved-items");
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    const searchHandler = vi.fn().mockResolvedValue({
      query: "filter note",
      results: [
        {
          family: "saved_item",
          canonical: { kind: "saved_item", id: "saved-same-route" },
          label: "Same-route filter note",
          supportingText: "Replacement details",
          lifecycle: "active",
          match: { kind: "exact", reason: "Matched wording", excerpt: "filter" },
          trust: "saved_context",
          sensitivity: "normal",
          visibility: { choice: "only_me", label: "Only me" },
          grounding: [{ kind: "saved_item", id: "saved-same-route" }],
          href: "/saved-items#saved-item-saved-same-route",
          parent: null,
          details: { kind: "note" },
        },
      ],
      limitations: [],
      hasMore: false,
    });

    render(
      <>
        <AppShell ownerUserId="owner-same-route" searchHandler={searchHandler}>
          <article id="saved-item-saved-same-route" tabIndex={-1}>
            Canonical saved target
          </article>
        </AppShell>
        <AppShellEffects />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(await screen.findByRole("textbox", { name: "Search Tendnote" }), "filter note");
    const resultLink = await screen.findByRole("link", { name: /Same-route filter note/ });
    await user.click(resultLink);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    await waitFor(() => expect(document.activeElement?.id).toBe("saved-item-saved-same-route"));
    sessionStorage.removeItem("tendnote:global-recall:owner-same-route");
    window.history.replaceState({}, "", "/");
  });

  it("renders the selected shaded Today band and the authoritative shortlist empty state", () => {
    render(
      <AppShell mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { name: "Today" })).toBeDefined();
    expect(screen.getByTestId("today-orientation-band").className).toContain("bg-panel");
    expect(screen.getByRole("textbox", { name: "Ask Eve anything" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Eve" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Today shortlist" })).toBeDefined();
    expect(screen.getByText("Nothing needs your attention today.")).toBeDefined();
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
    expect(await screen.findByRole("dialog", { name: "Eve" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Close" }));
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
    await user.click(screen.getByRole("button", { name: "Close" }));
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
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    render(
      <AppShell
        captureHandlers={{
          change: vi.fn(),
          submit: async () => ({ confirmation }),
          undo: vi.fn(),
        }}
        mobileHome
        ownerUserId="owner-1"
      >
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
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Capture" }));
    expect(screen.queryByText("Unsaved draft restored on this device.")).toBeNull();
  });

  it("changes a confirmed Capture reminder schedule without rewriting the saved wording", async () => {
    const user = userEvent.setup();
    const changeReminder = vi.fn().mockResolvedValue({
      reminderSchedule: "Reminder one day before at 9:00 AM · America/Chicago",
    });
    const confirmation = {
      destination: "Actions" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: {
        title: "Replace the filter",
        dueAt: "2026-08-14T14:00:00.000Z",
        cadence: null,
        scope: "Only me",
        reminderSchedule: "Reminder at 09:00 · America/Chicago",
      },
      change: { kind: "edit_general_action" as const, generalActionId: "action-1" },
      undo: { kind: "archive_general_action" as const, generalActionId: "action-1" },
    };
    render(
      <AppShell
        captureHandlers={{
          change: vi.fn(),
          changeReminder,
          submit: vi.fn().mockResolvedValue({ confirmation }),
          undo: vi.fn(),
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Remind me to replace the filter",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    await user.click(await screen.findByRole("button", { name: "Change reminder schedule" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Reminder alert time" }),
      "relative:1440",
    );
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() =>
      expect(changeReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          target: confirmation.change,
          schedule: { kind: "relative", leadMinutes: 1_440 },
        }),
      ),
    );
    expect(screen.getByText("Reminder one day before at 9:00 AM · America/Chicago")).toBeDefined();
  });

  it("continues one source-first clarification with the same interaction and original wording", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn()
      .mockResolvedValueOnce({
        clarification: {
          field: "timing" as const,
          question: "When should I remind you to replace the filter?",
          sourceRecordId: "source-1",
        },
      })
      .mockResolvedValueOnce({
        confirmation: {
          destination: "Actions" as const,
          groundedBySourceRecordId: "source-1",
          interpreted: {
            title: "Replace the filter",
            dueAt: "2026-07-22T14:00:00.000Z",
            cadence: null,
            scope: "Only me" as const,
          },
          change: { kind: "edit_general_action" as const, generalActionId: "action-1" },
          undo: { kind: "archive_general_action" as const, generalActionId: "action-1" },
        },
      });
    render(
      <AppShell
        captureHandlers={{ change: vi.fn(), submit, undo: vi.fn() }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Remind me to replace the filter sometime",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(
      await screen.findByRole("textbox", {
        name: "When should I remind you to replace the filter?",
      }),
    ).toBeDefined();
    expect(screen.getByText("Tendnote kept your original capture.")).toBeDefined();
    await user.type(
      screen.getByRole("textbox", { name: "When should I remind you to replace the filter?" }),
      "tomorrow",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Capture saved" })).toBeDefined();
    expect(screen.getAllByText("Actions")).toHaveLength(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      clarificationAnswer: "tomorrow",
      interactionId: submit.mock.calls[0]?.[0].interactionId,
      originalText: "Remind me to replace the filter sometime",
    });
  });

  it("offers Add and Link actions for an unknown Follow-Up person", async () => {
    const user = userEvent.setup();
    const clarification = {
      field: "person" as const,
      question: "Who did you mean by Maya?",
      sourceRecordId: "source-1",
      actions: [
        { kind: "add_person" as const, label: "Add Maya", displayName: "Maya" },
        { kind: "link_person" as const, label: "Link someone else" as const },
      ],
    };
    const confirmation = {
      destination: "Follow-Ups" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { person: "Maya", dueAt: "2026-07-21T14:00:00.000Z", scope: "Only me" as const },
      change: { kind: "edit_followup" as const, followupId: "followup-1" },
      undo: { kind: "archive_followup" as const, followupId: "followup-1" },
    };
    const addPerson = vi.fn().mockResolvedValue({ displayName: "Maya" });
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ clarification })
      .mockResolvedValueOnce({ confirmation });
    render(
      <AppShell
        captureHandlers={{
          addPerson,
          change: vi.fn(),
          submit,
          undo: vi.fn(),
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Remind me to follow up with Maya tomorrow",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByRole("button", { name: "Link someone else" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Add Maya" }));

    expect(addPerson).toHaveBeenCalledWith({
      displayName: "Maya",
      sourceRecordId: "source-1",
    });
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clarificationAnswer: "Maya",
        originalText: "Remind me to follow up with Maya tomorrow",
      }),
    );
    expect(await screen.findByText("Follow-Up with Maya")).toBeDefined();
  });

  it("replaces confirmation controls when Change reroutes to a new destination", async () => {
    const user = userEvent.setup();
    const savedConfirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const actionConfirmation = {
      destination: "Actions" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: {
        title: "Replace the filter",
        dueAt: null,
        cadence: null,
        scope: "Only me" as const,
      },
      change: { kind: "edit_general_action" as const, generalActionId: "action-1" },
      undo: { kind: "archive_general_action" as const, generalActionId: "action-1" },
    };
    const change = vi.fn().mockResolvedValue({ confirmation: actionConfirmation });
    const undo = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AppShell
        captureHandlers={{
          change,
          submit: vi.fn().mockResolvedValue({ confirmation: savedConfirmation }),
          undo,
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "The filter needs replacing",
    );
    const correction = await reopenCaptureForCorrection(user);
    await user.type(correction, "I need to replace the filter");
    await user.click(screen.getByRole("button", { name: "Save change" }));

    await waitFor(() => expect(screen.getAllByText("Actions")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledWith({
      target: { kind: "archive_general_action", generalActionId: "action-1" },
    });
  });

  it("shows and completes a focused clarification returned by Change", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const change = vi
      .fn()
      .mockResolvedValueOnce({
        clarification: {
          field: "timing" as const,
          question: "When should I remind you to replace the filter?",
          sourceRecordId: "source-1",
        },
      })
      .mockResolvedValueOnce({ confirmation });
    render(
      <AppShell
        captureHandlers={{
          change,
          submit: vi.fn().mockResolvedValue({ confirmation }),
          undo: vi.fn().mockResolvedValue({ ok: true }),
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(screen.getByRole("textbox", { name: "What should Tendnote keep?" }), "Note");
    const correction = await reopenCaptureForCorrection(user);
    await user.type(correction, "Remind me to replace the filter sometime");
    await user.click(screen.getByRole("button", { name: "Save change" }));

    const answer = await screen.findByRole("textbox", {
      name: "When should I remind you to replace the filter?",
    });
    await user.type(answer, "tomorrow");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(change).toHaveBeenLastCalledWith({
      clarificationAnswer: "tomorrow",
      target: confirmation.change,
      originalText: "Remind me to replace the filter sometime",
    });
  });

  it("keeps one interaction id across a failed retry and shows grounded Change and Undo controls", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Open question" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ confirmation });
    const change = vi.fn().mockResolvedValue({ ok: true });
    const undo = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AppShell captureHandlers={{ change, submit, undo }} mobileHome ownerUserId="owner-1">
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.click(screen.getByRole("button", { name: "Dictated transcript" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Where can I buy this filter?",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByDisplayValue("Where can I buy this filter?")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Capture wasn't saved" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Try saving again" }));
    expect(await screen.findByText("Tendnote kept your original capture.")).toBeDefined();
    expect(screen.getByText("Open question")).toBeDefined();
    expect(screen.getByText("Only me")).toBeDefined();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0].interactionId).toBe(submit.mock.calls[0]?.[0].interactionId);
    expect(submit.mock.calls[1]?.[0].inputMode).toBe("dictated");

    await user.click(screen.getByRole("button", { name: "Change" }));
    const changeInput = screen.getByRole("textbox", { name: "Rewrite what Tendnote saved" });
    await user.clear(changeInput);
    await user.type(changeInput, "Where should I buy this filter?");
    await user.click(screen.getByRole("button", { name: "Save change" }));
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        target: { kind: "edit_saved_item", savedItemId: "saved-1" },
        originalText: "Where should I buy this filter?",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("heading", { name: "Capture undone" })).toBeDefined();
    expect(undo).toHaveBeenCalledWith({
      target: { kind: "archive_saved_item", savedItemId: "saved-1" },
    });
  });

  it("shows one compact grouped confirmation and corrects one outcome without replacing its siblings", async () => {
    const user = userEvent.setup();
    const grouped = {
      destination: "Grouped" as const,
      groundedBySourceRecordId: "source-group",
      outcomes: [
        {
          destination: "People" as const,
          groundedBySourceRecordId: "source-group",
          interpreted: { displayName: "Priya", scope: "Only me" as const },
          change: {
            kind: "edit_person" as const,
            personId: "person-priya",
            sourceRecordId: "source-group",
          },
        },
        {
          destination: "Memories" as const,
          groundedBySourceRecordId: "source-group",
          interpreted: {
            person: "Priya",
            authority: "Approved" as const,
            scope: "Only me" as const,
          },
          change: {
            kind: "edit_memory" as const,
            memoryId: "memory-priya",
            sourceRecordId: "source-group",
          },
          undo: { kind: "archive_memory" as const, memoryId: "memory-priya" },
        },
        {
          destination: "Review" as const,
          groundedBySourceRecordId: "source-group",
          interpreted: {
            record: "Asset" as const,
            name: "refrigerator filter",
            authority: "Needs review" as const,
            scope: "Only me" as const,
          },
          change: {
            kind: "edit_asset_review" as const,
            groupId: "review-filter",
            sourceRecordId: "source-group",
          },
          undo: { kind: "dismiss_asset_review" as const, groupId: "review-filter" },
        },
      ],
    };
    const replacement = {
      destination: "Actions" as const,
      groundedBySourceRecordId: "source-group",
      interpreted: {
        title: "Buy oat milk",
        dueAt: null,
        cadence: null,
        scope: "Only me" as const,
      },
      change: { kind: "edit_general_action" as const, generalActionId: "action-oat" },
      undo: { kind: "archive_general_action" as const, generalActionId: "action-oat" },
    };
    const change = vi.fn().mockResolvedValue({ confirmation: replacement });
    render(
      <AppShell
        captureHandlers={{
          change,
          submit: vi.fn().mockResolvedValue({ confirmation: grouped }),
          undo: vi.fn(),
        }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Add Priya; remember that Priya prefers oat milk; track asset refrigerator filter",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByText("Approved Memory for Priya")).toBeDefined();
    expect(screen.getByText("refrigerator filter · Needs review")).toBeDefined();

    await user.click(screen.getAllByRole("button", { name: "Change" })[1] as HTMLElement);
    await user.type(
      screen.getByRole("textbox", { name: "Rewrite what Tendnote saved" }),
      "I need to buy oat milk",
    );
    await user.click(screen.getByRole("button", { name: "Save change" }));

    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        target: grouped.outcomes[1]?.change,
        originalText: "I need to buy oat milk",
      }),
    );
    expect(screen.getByText("Priya")).toBeDefined();
    expect(screen.getByText("Buy oat milk")).toBeDefined();
    expect(screen.getByText("refrigerator filter · Needs review")).toBeDefined();
  });

  it("adds a live dictated transcript without retaining audio provenance", async () => {
    const user = userEvent.setup();
    const stopRecognition = vi.fn();
    let recognition:
      | {
          onend: (() => void) | null;
          onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
        }
      | undefined;
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null =
        null;
      constructor() {
        recognition = this;
      }
      start() {}
      stop() {
        stopRecognition();
        this.onend?.();
      }
    }
    Object.defineProperty(globalThis, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const submit = vi.fn().mockResolvedValue({ confirmation });
    render(
      <AppShell
        captureHandlers={{ change: vi.fn(), submit, undo: vi.fn() }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.click(screen.getByRole("button", { name: "Start dictation" }));
    recognition?.onresult?.({ results: [{ 0: { transcript: "Remember filter model 9000" } }] });
    recognition?.onend?.();
    expect(await screen.findByDisplayValue("Remember filter model 9000")).toBeDefined();
    expect(screen.getByText("Dictated transcript added.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMode: "dictated",
        originalText: "Remember filter model 9000",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(stopRecognition).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(globalThis, "webkitSpeechRecognition");
  });

  it("starts a distinct interaction after discarding a failed capture", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-2",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-2" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-2" },
    };
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("ambiguous failure"))
      .mockResolvedValueOnce({ confirmation });
    render(
      <AppShell
        captureHandlers={{ change: vi.fn(), submit, undo: vi.fn() }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    const input = screen.getByRole("textbox", { name: "What should Tendnote keep?" });
    await user.type(input, "First draft");
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    expect(await screen.findByRole("heading", { name: "Capture wasn't saved" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.queryByRole("heading", { name: "Capture wasn't saved" })).toBeNull();
    await user.type(input, "Separate draft");
    await user.click(screen.getByRole("button", { name: "Save capture" }));

    expect(submit.mock.calls[1]?.[0].interactionId).not.toBe(
      submit.mock.calls[0]?.[0].interactionId,
    );
    expect(await screen.findByRole("heading", { name: "Capture saved" })).toBeDefined();
  });

  it("never turns a failed Change retry into Undo after Cancel", async () => {
    const user = userEvent.setup();
    const confirmation = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Note" as const, visibility: "Only me" as const },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-1" },
    };
    const change = vi.fn().mockRejectedValue(new Error("change failed"));
    const undo = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AppShell
        captureHandlers={{ change, submit: vi.fn().mockResolvedValue({ confirmation }), undo }}
        mobileHome
        ownerUserId="owner-1"
      >
        <p>Desktop dashboard</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Capture" }));
    await user.type(
      screen.getByRole("textbox", { name: "What should Tendnote keep?" }),
      "Original note",
    );
    await user.click(screen.getByRole("button", { name: "Save capture" }));
    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("button", { name: "Save change" }));
    expect(await screen.findByRole("heading", { name: "Change wasn't saved" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Try change again" })).toBeNull();
    expect(undo).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
