import type { ContextFactView } from "@tendnote/domain";
import type { GlobalRecallResponse } from "@tendnote/domain/global-recall";
import type { TodayShortlistResponse } from "@tendnote/domain/today";
import { act, type ComponentProps, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { ReviewQueueItem } from "@/lib/review-queue";
import { renderInBrowser } from "@/test/browser";
import {
  expectFailedFocusedMutation,
  expectTouchTargetButtons,
  focusAndPressEnter,
} from "@/test/browser-context-fact-helpers";
import { AboutYouSurface } from "./account/about-you-surface";
import { ActionsSurface } from "./actions-surface";
import { AppShell } from "./app-shell";
import { AppShellEffects } from "./app-shell-effects";
import { MobileTodayDestination } from "./mobile-today-destination";
import { PeopleList } from "./people-list";
import { ReminderOptInInvitation } from "./reminder-opt-in-invitation";
import { ReviewQueueSection } from "./review-queue-section";

vi.mock("@/components/mobile-eve-surface", () => ({
  EveSurface: () => (
    <div className="flex h-full flex-col gap-3">
      <div aria-label="Eve transcript" role="log">
        <p>What would you like to recall?</p>
      </div>
      <label htmlFor="phase-seven-eve-composer">Message Eve</label>
      <textarea className="min-h-20 shrink-0" id="phase-seven-eve-composer" />
    </div>
  ),
}));

const cleanups: Array<() => Promise<void>> = [];
const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  if (originalUserAgent) Object.defineProperty(navigator, "userAgent", originalUserAgent);
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
});

async function mount(ui: React.ReactNode) {
  const rendered = await renderInBrowser(ui);
  cleanups.push(rendered.unmount);
  return rendered.container;
}

async function restoreSearchFromHistory(input: {
  dialogName: string;
  inputRole: "textbox" | "combobox";
  inputName: string;
  query: string;
}) {
  await act(async () => window.history.back());
  await expect.element(page.getByRole("dialog", { name: input.dialogName })).toBeVisible();
  const searchInput = page.getByRole(input.inputRole, { name: input.inputName });
  await expect.element(searchInput).toHaveValue(input.query);
  await expect.element(searchInput).toHaveFocus();
}

const today: TodayShortlistResponse = {
  items: [
    {
      identity: "saved_item:filter-question",
      family: "saved_item",
      record: {
        kind: "saved_item",
        id: "filter-question",
        href: "/saved-items#saved-item-filter-question",
      },
      title: "Where should I buy the replacement filter?",
      context: "Open question",
      reason: {
        code: "bring_back_arrived",
        key: "bring-back:2026-08-14T14:00:00.000Z",
        explanation: "Set to return Aug 14.",
      },
      sourceRefs: [{ kind: "saved_item", id: "filter-question" }],
      action: {
        kind: "open_record",
        label: "Open",
        href: "/saved-items#saved-item-filter-question",
      },
      mandatory: false,
      dueAt: new Date("2026-08-14T14:00:00.000Z"),
      createdAt: new Date("2026-07-21T15:00:00.000Z"),
      sensitivity: "normal",
    },
  ],
  candidateFingerprint: "phase-seven-proof",
  curation: "deterministic_fallback",
  overflow: null,
  limitations: ["Part of Today is temporarily unavailable. Your records are unchanged."],
};

const sourceReview: ReviewQueueItem = {
  family: "source-record",
  id: "source-filter-review",
  review: {
    component: { type: "source_record_review", sourceRecordId: "source-filter-review" },
    sourceRecord: {
      id: "source-filter-review",
      ownerUserId: "owner-1",
      sourceType: "manual",
      content: "Maya recommended checking the refrigerator filter seal.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
      createdAt: "2026-07-21T15:00:00.000Z",
      updatedAt: "2026-07-21T15:00:00.000Z",
    },
    linkedPeople: [],
    unresolvedMentions: [{ id: "mention-maya", mentionText: "Maya", candidatePersonIds: [] }],
  },
};

const suggestedContextFactReview: ReviewQueueItem = {
  family: "suggested-context-fact",
  id: "suggested-context-fact-review",
  review: {
    fact: {
      id: "00000000-0000-4000-8000-000000000006",
      subject: { kind: "self" },
      category: "work",
      content: "I work from Chicago.",
      lifecycle: "suggested",
      sensitivity: "normal",
      provenance: { channel: "ambient", origin: "ambient" },
      reviewedAt: null,
      archivedAt: null,
      createdAt: new Date("2026-07-21T15:00:00.000Z"),
      updatedAt: new Date("2026-07-21T15:00:00.000Z"),
      trust: "untrusted_data",
      authority: "none",
      visibility: "private",
    },
    evidence: "The conversation included a Chicago work location.",
    activeMatch: null,
  },
};

const selfContextRecallResponse: GlobalRecallResponse = {
  query: "software",
  results: [
    {
      family: "self_context",
      canonical: { kind: "context_fact", id: "context-fact-1" },
      label: "I run a software consultancy.",
      supportingText: "Work",
      lifecycle: "active",
      match: { kind: "exact", reason: "Matched Self Context content", excerpt: "software" },
      trust: "self_context",
      sensitivity: "normal",
      visibility: { choice: "only_me", label: "Only me" },
      grounding: [{ kind: "context_fact", id: "context-fact-1" }],
      href: "/account/about-you#context-fact-context-fact-1",
      parent: null,
      details: {
        content: "I run a software consultancy.",
        category: "work",
        categoryLabel: "Work",
        provenance: { channel: "account", origin: "direct" },
      },
    },
  ],
  limitations: [],
  hasMore: false,
};

const selfContextFact: ContextFactView = {
  id: "context-fact-1",
  subject: { kind: "self" },
  category: "work",
  content: "I run a software consultancy.",
  lifecycle: "active",
  sensitivity: "normal",
  provenance: { channel: "account", origin: "direct" },
  reviewedAt: new Date("2026-08-02T12:00:00.000Z"),
  archivedAt: null,
  createdAt: new Date("2026-08-02T12:00:00.000Z"),
  updatedAt: new Date("2026-08-02T12:00:00.000Z"),
  trust: "untrusted_data",
  authority: "none",
  visibility: "private",
};

function currentLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function RecallRouteHarness({
  ownerUserId,
  searchHandler,
}: {
  ownerUserId: string;
  searchHandler: NonNullable<ComponentProps<typeof AppShell>["searchHandler"]>;
}) {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);

  return (
    <>
      <AppShell ownerUserId={ownerUserId} searchHandler={searchHandler}>
        {location.startsWith("/account/about-you") ? (
          <AboutYouSurface initialFacts={[selfContextFact]} />
        ) : (
          <div />
        )}
      </AppShell>
      <AppShellEffects />
    </>
  );
}

describe("Phase Seven phone browser proof", () => {
  it("takes mobile Search to an exact Self Context correction and preserves return state", async () => {
    await page.viewport(390, 844);
    window.history.replaceState({}, "", "/");
    const searchHandler = vi.fn(async () => ({
      ok: true as const,
      view: selfContextRecallResponse,
    }));
    await mount(<RecallRouteHarness ownerUserId="owner-1" searchHandler={searchHandler} />);

    await act(async () => userEvent.click(page.getByRole("button", { name: "Search" })));
    await act(async () =>
      userEvent.fill(page.getByRole("textbox", { name: "Search Tendnote" }), "software"),
    );
    const result = page.getByRole("link", {
      name: /I run a software consultancy\. Work/,
    });
    await expect.element(result).toBeVisible();
    await expect
      .element(result)
      .toHaveAttribute("href", "/account/about-you#context-fact-context-fact-1");
    expect((await result.element()).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    await act(async () => userEvent.click(result));
    expect(page.getByRole("dialog", { name: "Search" }).query()).toBeNull();
    await expect.element(page.getByRole("heading", { name: "About you" })).toBeVisible();
    await expect.element(page.getByRole("article")).toHaveFocus();

    await restoreSearchFromHistory({
      dialogName: "Search",
      inputRole: "textbox",
      inputName: "Search Tendnote",
      query: "software",
    });
    sessionStorage.removeItem("tendnote:global-recall:owner-1");
  });

  it("takes desktop Search to the focused Self Context correction and restores the result on return", async () => {
    await page.viewport(1280, 900);
    window.history.replaceState({}, "", "/");
    const searchHandler = vi.fn(async () => ({
      ok: true as const,
      view: selfContextRecallResponse,
    }));
    await mount(<RecallRouteHarness ownerUserId="owner-desktop" searchHandler={searchHandler} />);

    await act(async () => userEvent.click(page.getByRole("button", { name: "Search Tendnote" })));
    await act(async () =>
      userEvent.fill(page.getByRole("combobox", { name: "Search and commands" }), "software"),
    );
    await expect.poll(() => searchHandler.mock.calls.length).toBeGreaterThan(0);
    const result = page.getByRole("option", {
      name: /I run a software consultancy/,
    });
    await expect.element(result).toBeVisible();
    const input = page.getByRole("combobox", { name: "Search and commands" });
    await expect.element(input).toHaveFocus();
    await act(async () => userEvent.keyboard("{ArrowDown}"));
    await expect.element(result).toHaveAttribute("aria-selected", "true");
    await act(async () => userEvent.click(result));

    expect(window.location.pathname).toBe("/account/about-you");
    await expect.element(page.getByRole("heading", { name: "About you" })).toBeVisible();
    await expect.element(page.getByRole("article")).toHaveFocus();

    await restoreSearchFromHistory({
      dialogName: "Search and commands",
      inputRole: "combobox",
      inputName: "Search and commands",
      query: "software",
    });
    await expect
      .element(page.getByRole("option", { name: /I run a software consultancy/ }))
      .toHaveFocus();
    sessionStorage.removeItem("tendnote:global-recall:owner-desktop");
    window.history.replaceState({}, "", "/");
  });

  it("keeps Today and every focused flow reachable, named, focus-safe, and usable at 200% text", async () => {
    await page.viewport(390, 844);
    document.documentElement.style.fontSize = "200%";
    const handlers = {
      refresh: vi.fn(async () => ({ ok: true as const, view: today })),
      restore: vi.fn(async () => ({ ok: true as const, view: today })),
      suppress: vi.fn(async () => ({
        ok: true as const,
        view: { ...today, items: [] },
      })),
      act: vi.fn(async () => ({ ok: true as const, view: today })),
    };
    const captureHandlers = {
      addPerson: vi.fn(),
      change: vi.fn(),
      changeReminder: vi.fn(),
      submit: vi.fn(async () => {
        throw new Error("app server unavailable");
      }),
      undo: vi.fn(),
    };
    const container = await mount(
      <AppShell captureHandlers={captureHandlers} ownerUserId="owner-1" searchHandler={vi.fn()}>
        <div data-mobile-bleed>
          <MobileTodayDestination
            ownerUserId="owner-1"
            todayHandlers={handlers}
            todayInitial={today}
            todayLocalDate="2026-08-14"
            todayTimeZone="America/Chicago"
          />
        </div>
      </AppShell>,
    );
    const closeFocusedFlow = () =>
      act(async () => {
        await userEvent.click(page.getByRole("button", { name: "Close" }));
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      });

    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    const navigation = page.getByRole("navigation", { name: "Mobile primary" });
    const navigationElement = await navigation.element();
    expect(navigationElement.className).toContain("env(safe-area-inset-bottom)");
    expect(
      Number.parseFloat(getComputedStyle(navigationElement).paddingBottom),
    ).toBeGreaterThanOrEqual(0);
    for (const name of ["Today", "Search", "Capture", "Review", "Menu"]) {
      const control = navigation.getByRole(
        name === "Today" || name === "Review" ? "link" : "button",
        {
          name,
        },
      );
      const box = (await control.element()).getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect((await control.element()).className).toContain("motion-reduce:transition-none");
    }
    expect(page.getByText("Set to return Aug 14.")).toBeVisible();
    await expect
      .element(page.getByText(/Part of Today is temporarily unavailable/i))
      .toHaveAttribute("role", "status");
    const itemMenu = page.getByRole("button", {
      name: "More options for Where should I buy the replacement filter?",
    });
    expect((await itemMenu.element()).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    await act(async () => userEvent.click(navigation.getByRole("button", { name: "Search" })));
    await expect.element(page.getByRole("dialog", { name: "Search" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Search Tendnote" })).toHaveFocus();
    const searchHeader = (
      await page.getByRole("dialog", { name: "Search" }).element()
    ).querySelector("header");
    expect(
      Number.parseFloat(getComputedStyle(searchHeader as Element).paddingTop),
    ).toBeGreaterThanOrEqual(0);
    expect(page.getByRole("navigation", { name: "Mobile primary" }).query()).toBeNull();

    await closeFocusedFlow();
    await expect.element(page.getByRole("button", { name: "Search" })).toHaveFocus();
    await act(async () => userEvent.click(page.getByRole("button", { name: "Capture" })));
    await expect.element(page.getByRole("dialog", { name: "Capture" })).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "What should Tendnote keep?" }))
      .toHaveFocus();
    await page.viewport(390, 520);
    await act(async () =>
      userEvent.fill(
        page.getByRole("textbox", { name: "What should Tendnote keep?" }),
        "Save a note: check the filter seal",
      ),
    );
    await act(async () => userEvent.click(page.getByRole("button", { name: "Save capture" })));
    await expect.element(page.getByRole("heading", { name: "Capture wasn't saved" })).toBeVisible();
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(captureHandlers.submit).toHaveBeenCalledOnce();
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);

    await closeFocusedFlow();
    await expect.element(page.getByRole("button", { name: "Capture" })).toHaveFocus();
    await page.viewport(390, 844);
    await act(async () =>
      userEvent.click(page.getByRole("button", { name: "Open the assistant" })),
    );
    await expect.element(page.getByRole("dialog", { name: "Assistant" })).toBeVisible();
    await expect.element(page.getByRole("log", { name: "Eve transcript" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Message Eve" })).toBeVisible();
    await closeFocusedFlow();
    await expect.element(page.getByRole("button", { name: "Open the assistant" })).toHaveFocus();

    const menuButton = page.getByRole("button", { name: "Menu" });
    await act(async () => {
      (await menuButton.element()).focus();
      await userEvent.keyboard("{Enter}");
    });
    await expect.element(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    const account = page.getByRole("link", { name: "Account" });
    await expect.element(account).toHaveAttribute("href", "/account");
    expect((await account.element()).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await closeFocusedFlow();
  });

  it("confirms Self Context on mobile and keeps Change and authoritative Undo reachable", async () => {
    await page.viewport(390, 844);
    const confirmation = {
      destination: "Self Context" as const,
      groundedBySourceRecordId: "source-self-context-1",
      interpreted: {
        category: "work" as const,
        content: "I run a small software consultancy",
        sensitivity: "normal" as const,
        scope: "Only me",
      },
      change: {
        kind: "edit_context_fact" as const,
        contextFactId: "context-fact-1",
        sourceRecordId: "source-self-context-1",
        expectedUpdatedAt: "2026-08-02T04:30:00.000Z",
      },
      undo: {
        kind: "archive_context_fact" as const,
        contextFactId: "context-fact-1",
        sourceRecordId: "source-self-context-1",
        expectedUpdatedAt: "2026-08-02T04:30:00.000Z",
      },
    };
    const changedConfirmation = {
      ...confirmation,
      interpreted: {
        ...confirmation.interpreted,
        category: "preference" as const,
        content: "I prefer concise answers",
      },
      change: {
        ...confirmation.change,
        expectedUpdatedAt: "2026-08-02T04:31:00.000Z",
      },
      undo: {
        kind: "edit_context_fact" as const,
        contextFactId: "context-fact-1",
        sourceRecordId: "source-self-context-1",
        category: "work" as const,
        content: "I run a small software consultancy",
        sensitivity: "normal" as const,
        expectedUpdatedAt: "2026-08-02T04:31:00.000Z",
      },
    };
    const submit = vi.fn(async () => ({ ok: true as const, view: { confirmation } }));
    const change = vi.fn(async () => ({
      ok: true as const,
      view: { confirmation: changedConfirmation },
    }));
    const undo = vi.fn(async () => ({ ok: true as const, view: {} }));
    await mount(
      <AppShell
        captureHandlers={{ addPerson: vi.fn(), change, submit, undo }}
        ownerUserId="owner-1"
        searchHandler={vi.fn()}
      >
        <div />
      </AppShell>,
    );

    await act(async () => userEvent.click(page.getByRole("button", { name: "Capture" })));
    await act(async () =>
      userEvent.fill(
        page.getByRole("textbox", { name: "What should Tendnote keep?" }),
        "Remember that I run a small software consultancy",
      ),
    );
    await act(async () => userEvent.click(page.getByRole("button", { name: "Save capture" })));
    await expect.element(page.getByRole("heading", { name: "Capture saved" })).toBeVisible();
    await expect.element(page.getByText("Self Context")).toBeVisible();
    await expect.element(page.getByText("I run a small software consultancy")).toBeVisible();

    await act(async () => {
      (await page.getByRole("button", { name: "Change" }).element()).focus();
      await userEvent.keyboard("{Enter}");
    });
    await expect
      .element(page.getByRole("textbox", { name: "Rewrite what Tendnote saved" }))
      .toHaveFocus();
    await act(async () =>
      userEvent.fill(
        page.getByRole("textbox", { name: "Rewrite what Tendnote saved" }),
        "Remember that I prefer concise answers",
      ),
    );
    await act(async () => userEvent.click(page.getByRole("button", { name: "Save change" })));
    await expect.element(page.getByText("I prefer concise answers")).toBeVisible();
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        target: confirmation.change,
        originalText: "Remember that I prefer concise answers",
      }),
    );

    await act(async () => userEvent.click(page.getByRole("button", { name: "Undo" })));
    await expect.element(page.getByRole("heading", { name: "Capture undone" })).toBeVisible();
    expect(undo).toHaveBeenCalledWith({ target: changedConfirmation.undo });
  });

  it("keeps the real Review queue operable and non-color-dependent on a phone", async () => {
    await page.viewport(390, 844);
    document.documentElement.style.fontSize = "200%";
    const container = await mount(
      <AppShell ownerUserId="owner-1">
        <ReviewQueueSection items={[sourceReview]} onResolve={vi.fn()} onUpdate={vi.fn()} />
      </AppShell>,
    );

    await expect.element(page.getByRole("list", { name: "Review queue" })).toBeVisible();
    await expect.element(page.getByText(/Maya recommended checking/)).toBeVisible();
    const linkPerson = page.getByRole("link", { name: "Link someone else" });
    const addPerson = page.getByRole("button", { name: "Add Maya" });
    for (const control of [linkPerson, addPerson]) {
      const box = (await control.element()).getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await act(async () => {
      (await linkPerson.element()).focus();
      await userEvent.keyboard("{Tab}");
    });
    await expect.element(addPerson).toHaveFocus();
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  });

  it("keeps Suggested Self Context review actionable from the real Review entry point", async () => {
    await page.viewport(390, 844);
    document.documentElement.style.fontSize = "200%";
    const accepted = {
      ...suggestedContextFactReview.review.fact,
      content: "The reviewed work location.",
      lifecycle: "active" as const,
      reviewedAt: new Date("2026-08-02T12:01:00.000Z"),
    };
    const acceptAction = vi.fn(async () => ({
      ok: true as const,
      view: { fact: accepted, decision: "accepted" as const },
    }));

    function ReviewHarness() {
      const [items, setItems] = useState([suggestedContextFactReview]);
      return (
        <>
          <ReviewQueueSection
            items={items}
            onResolve={() => setItems([])}
            onUpdate={vi.fn()}
            suggestedContextFactAcceptAction={acceptAction}
          />
          {items.length === 0 ? <p>Review resolved.</p> : null}
        </>
      );
    }

    const container = await mount(
      <AppShell ownerUserId="owner-1">
        <ReviewHarness />
      </AppShell>,
    );

    await expect.element(page.getByRole("list", { name: "Review queue" })).toBeVisible();
    await expect.element(page.getByText("I work from Chicago.")).toBeVisible();
    await expect
      .element(page.getByText("The conversation included a Chicago work location."))
      .toBeVisible();
    await expectTouchTargetButtons(["Dismiss suggested fact", "Edit", "Accept"]);
    await focusAndPressEnter(page.getByRole("button", { name: "Accept" }));
    await expect.element(page.getByText("Review resolved.")).toBeVisible();
    expect(page.getByText("I work from Chicago.").query()).toBeNull();
    expect(acceptAction).toHaveBeenCalledWith({
      contextFactId: "00000000-0000-4000-8000-000000000006",
      expectedUpdatedAt: "2026-07-21T15:00:00.000Z",
    });
    await expect.element(page.getByRole("heading", { name: "Needs review" })).toHaveFocus();
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it("keeps Review suggestion actions recoverable after failed accept and dismiss", async () => {
    await page.viewport(390, 844);
    document.documentElement.style.fontSize = "200%";
    const acceptAction = vi.fn(async () => ({
      ok: false as const,
      error: "That suggestion changed elsewhere. Refresh the review and try again.",
    }));
    const dismissAction = vi.fn(async () => ({
      ok: false as const,
      error: "The suggestion could not be dismissed. Try again.",
    }));

    const container = await mount(
      <AppShell ownerUserId="owner-1">
        <ReviewQueueSection
          items={[suggestedContextFactReview]}
          onResolve={vi.fn()}
          onUpdate={vi.fn()}
          suggestedContextFactAcceptAction={acceptAction}
          suggestedContextFactDismissAction={dismissAction}
        />
      </AppShell>,
    );

    await expectFailedFocusedMutation({
      buttonName: "Accept",
      errorText: "changed elsewhere",
      factText: "I work from Chicago.",
    });
    await expectFailedFocusedMutation({
      buttonName: "Dismiss suggested fact",
      errorText: "could not be dismissed",
      factText: "I work from Chicago.",
    });
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  });

  /**
   * The phone gutter, asserted against real computed style rather than class names.
   *
   * The route frame uses the built-in token-backed utility over `--tn-gutter`, while
   * `px-gutter` and `mx-bleed` remain custom utilities for other mobile surfaces.
   * A missing token or utility leaves every mobile screen edge-to-edge without
   * throwing, so this measures the pixels.
   */
  it("gives the phone shell one gutter that a full-bleed bar cancels exactly", async () => {
    await page.viewport(390, 844);
    const container = await mount(
      <AppShell ownerUserId="owner-1">
        <div className="mx-bleed" data-testid="bleed-bar">
          Sticky bar
        </div>
        <p data-testid="padded-content">Padded content</p>
      </AppShell>,
    );

    const main = container.querySelector("main") as HTMLElement;
    const gutter = Number.parseFloat(getComputedStyle(main).paddingLeft);
    expect(gutter).toBeGreaterThan(0);
    expect(Number.parseFloat(getComputedStyle(main).paddingRight)).toBe(gutter);

    // Destination pages sit directly inside this main. Their headings, copy, and
    // framed controls must share the same inset; the border itself cannot touch
    // the viewport edge on a phone.
    const content = container.querySelector('[data-testid="padded-content"]') as HTMLElement;
    const contentBox = content.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    expect(contentBox.left).toBeCloseTo(mainBox.left + gutter, 1);
    expect(contentBox.right).toBeCloseTo(mainBox.right - gutter, 1);

    // A bar marked `mx-bleed` reaches both screen edges - no wider, no narrower -
    // which is the whole contract the person and asset ledger toolbars rely on.
    const bar = container.querySelector('[data-testid="bleed-bar"]') as HTMLElement;
    const barBox = bar.getBoundingClientRect();
    expect(barBox.left).toBeCloseTo(mainBox.left, 1);
    expect(barBox.right).toBeCloseTo(mainBox.right, 1);
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);

    // Past `sm` the call sites hand over to `sm:px-6`, which only wins because a
    // variant utility sorts after a plain one. That ordering is Tailwind's to keep,
    // not ours, so the widening is measured rather than assumed - otherwise a
    // custom `@utility` that started winning would pin every desktop surface to the
    // phone gutter with nothing failing.
    await page.viewport(900, 844);
    await expect
      .poll(() => Number.parseFloat(getComputedStyle(main).paddingLeft))
      .toBeGreaterThan(gutter);
  });

  it.each(["actions", "people"] as const)(
    "keeps the %s destination content inside the phone gutter",
    async (destination) => {
      await page.viewport(390, 844);
      const container = await mount(
        <AppShell ownerUserId="owner-1">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" data-testid="route-surface">
            <header>
              <h1>{destination === "actions" ? "Actions" : "People"}</h1>
            </header>
            {destination === "actions" ? (
              <ActionsSurface active={[]} areas={[]} />
            ) : (
              <PeopleList people={[]} />
            )}
          </div>
        </AppShell>,
      );

      const surface = container.querySelector('[data-testid="route-surface"]') as HTMLElement;
      const surfaceBox = surface.getBoundingClientRect();
      expect(surfaceBox.left).toBeGreaterThan(0);
      expect(surfaceBox.right).toBeLessThan(window.innerWidth);
      expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    },
  );

  it("shows iOS installation guidance without exposing platform permission early", async () => {
    await page.viewport(390, 844);
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });

    const container = await mount(
      <ReminderOptInInvitation
        clientInstallationId="ios-safari-installation"
        onDismiss={vi.fn()}
      />,
    );

    await expect.element(page.getByText(/In Safari, tap Share/)).toBeVisible();
    expect(page.getByRole("button", { name: "Enable reminders" }).query()).toBeNull();
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  });
});
