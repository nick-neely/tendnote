import type { TodayShortlistResponse } from "@tendnote/domain/today";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { ReviewQueueItem } from "@/lib/review-queue";
import { renderInBrowser } from "@/test/browser";
import { AppShell } from "./app-shell";
import { ReminderOptInInvitation } from "./general-action-reminder";
import { ReviewQueueSection } from "./review-queue-section";

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
  limitations: ["Eve ranking is unavailable; deterministic ordering used."],
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

describe("Phase Seven phone browser proof", () => {
  it("keeps Today and every focused flow reachable, named, focus-safe, and usable at 200% text", async () => {
    await page.viewport(390, 844);
    document.documentElement.style.fontSize = "200%";
    const handlers = {
      refresh: vi.fn(async () => ({ ok: true as const, view: today })),
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
      <AppShell
        captureHandlers={captureHandlers}
        mobileEve={
          <div className="flex h-full flex-col gap-3">
            <div aria-label="Eve transcript" role="log">
              <p>What would you like to recall?</p>
            </div>
            <label htmlFor="phase-seven-eve-composer">Message Eve</label>
            <textarea className="min-h-20 shrink-0" id="phase-seven-eve-composer" />
          </div>
        }
        mobileHome
        ownerUserId="owner-1"
        searchHandler={vi.fn()}
        todayHandlers={handlers}
        todayInitial={today}
        todayLocalDate="2026-08-14"
        todayTimeZone="America/Chicago"
      >
        <p>Desktop fallback</p>
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
      .element(page.getByText(/deterministic ordering used/i))
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
    await act(async () => userEvent.click(page.getByRole("button", { name: "Open Eve" })));
    await expect.element(page.getByRole("dialog", { name: "Eve" })).toBeVisible();
    await expect.element(page.getByRole("log", { name: "Eve transcript" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Message Eve" })).toBeVisible();
    await closeFocusedFlow();
    await expect.element(page.getByRole("button", { name: "Open Eve" })).toHaveFocus();

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

  it("keeps the real Review queue operable and non-color-dependent on a phone", async () => {
    await page.viewport(390, 844);
    document.documentElement.style.fontSize = "200%";
    const container = await mount(
      <AppShell mobileReview ownerUserId="owner-1">
        <ReviewQueueSection items={[sourceReview]} onResolve={vi.fn()} onUpdate={vi.fn()} />
      </AppShell>,
    );

    await expect.element(page.getByRole("list", { name: "Review queue" })).toBeVisible();
    await expect.element(page.getByText(/Maya recommended checking/)).toBeVisible();
    const reviewLink = page.getByRole("link", { name: "Review" });
    await expect.element(reviewLink).toHaveAttribute("aria-current", "page");
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
