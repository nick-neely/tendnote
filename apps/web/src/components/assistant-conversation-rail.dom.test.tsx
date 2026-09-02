// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import type { AssistantConversationView } from "@/app/actions/assistant-conversations";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";
import { AssistantConversationRail } from "./assistant-conversation-rail";

/**
 * The rail is the only way back into a past conversation — eve keeps no session
 * index and hands back no title (ADR 0238) — so these cover the three things
 * that make it findable: the date sections, which row is the one you are in, and
 * the two ways a thread can be tidied.
 */

const NOW = new Date("2026-09-02T10:00:00");

function conversation(
  overrides: Partial<AssistantConversationView> & { sessionId: string },
): AssistantConversationView {
  return {
    archived: false,
    lastActivityAt: NOW,
    title: overrides.sessionId,
    ...overrides,
  };
}

const CONVERSATIONS: AssistantConversationView[] = [
  conversation({ sessionId: "wrun_today", title: "Updates on Priya Shah" }),
  conversation({
    sessionId: "wrun_yesterday",
    title: "Notes on Jordan",
    lastActivityAt: new Date("2026-09-01T22:30:00"),
  }),
  conversation({
    sessionId: "wrun_week",
    title: "What we know about Sam",
    lastActivityAt: new Date("2026-08-29T09:00:00"),
  }),
  conversation({
    sessionId: "wrun_old",
    title: "Gift ideas for Mara",
    lastActivityAt: new Date("2026-07-04T09:00:00"),
  }),
];

const handlers = {
  onArchive: vi.fn(async () => {}),
  onNavigate: vi.fn(),
  onNewConversation: vi.fn(),
  onRename: vi.fn(async () => {}),
  onUnarchive: vi.fn(async () => {}),
};

function renderRail(props: Partial<Parameters<typeof AssistantConversationRail>[0]> = {}) {
  return render(
    <AssistantConversationRail
      archived={[]}
      conversations={CONVERSATIONS}
      currentSessionId={null}
      now={NOW}
      {...handlers}
      {...props}
    />,
  );
}

beforeEach(() => {
  for (const handler of Object.values(handlers)) handler.mockClear();
});

it("sections the list by when each thread was last used", () => {
  renderRail();

  expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
    "Today",
    "Yesterday",
    "Previous 7 days",
    "Older",
  ]);
});

it("leaves out a heading with nothing under it", () => {
  renderRail({ conversations: [CONVERSATIONS[0] as AssistantConversationView] });

  expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Today"]);
});

/** Selection is never colour alone (DESIGN.md §8): the row also claims the page. */
it("marks the thread you are in, and only that one", () => {
  renderRail({ currentSessionId: "wrun_yesterday" });

  expect(screen.getByRole("link", { name: "Notes on Jordan" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(
    screen.getByRole("link", { name: "Updates on Priya Shah" }).getAttribute("aria-current"),
  ).toBeNull();
});

it("opens a thread through its own URL so the check on it actually runs", () => {
  renderRail();

  expect(screen.getByRole("link", { name: "Updates on Priya Shah" }).getAttribute("href")).toBe(
    "/assistant/wrun_today",
  );
});

it("renames a thread in place and keeps the new name on screen", async () => {
  renderRail();

  await userEvent.click(screen.getByRole("button", { name: "Actions for Notes on Jordan" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

  const field = screen.getByRole("textbox", { name: "Rename Notes on Jordan" });
  await userEvent.clear(field);
  await userEvent.type(field, "Jordan check-in{Enter}");

  await waitFor(() =>
    expect(handlers.onRename).toHaveBeenCalledWith("wrun_yesterday", "Jordan check-in"),
  );
  // The field yields back to the row once the rename lands.
  await waitFor(() => expect(screen.queryByRole("textbox", { name: /^Rename/ })).toBeNull());
});

it("abandons a rename on Escape without writing anything", async () => {
  renderRail();

  await userEvent.click(screen.getByRole("button", { name: "Actions for Notes on Jordan" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Rename Notes on Jordan" }), "{Escape}");

  await waitFor(() => expect(screen.getByRole("link", { name: "Notes on Jordan" })).toBeDefined());
  expect(handlers.onRename).not.toHaveBeenCalled();
});

/**
 * Archive, not delete. Tendnote cannot erase eve's durable stream, so the row is
 * put away rather than destroyed — and the menu must not offer more than that.
 */
it("offers archive and never delete", async () => {
  renderRail();

  await userEvent.click(screen.getByRole("button", { name: "Actions for Notes on Jordan" }));

  expect(screen.getByRole("menuitem", { name: "Archive" })).toBeDefined();
  expect(screen.queryByRole("menuitem", { name: /delete/i })).toBeNull();

  await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
  await waitFor(() => expect(handlers.onArchive).toHaveBeenCalledWith("wrun_yesterday"));
});

it("keeps archived threads out of the list until they are asked for", async () => {
  const archived = [
    conversation({ sessionId: "wrun_put_away", title: "Old planning", archived: true }),
  ];
  renderRail({ archived });

  expect(screen.queryByRole("link", { name: "Old planning" })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Show archived (1)" }));

  // Still readable: archiving hides a thread from the list, it does not close it.
  expect(screen.getByRole("link", { name: "Old planning" }).getAttribute("href")).toBe(
    "/assistant/wrun_put_away",
  );

  await userEvent.click(screen.getByRole("button", { name: "Restore Old planning" }));
  await waitFor(() => expect(handlers.onUnarchive).toHaveBeenCalledWith("wrun_put_away"));
});

/** An affordance that reveals nothing teaches the reader to ignore it. */
it("does not offer to show archived threads when there are none", () => {
  renderRail();

  expect(screen.queryByRole("button", { name: /show archived/i })).toBeNull();
});

it("says what an empty list means rather than showing bare headings", () => {
  renderRail({ conversations: [] });

  expect(screen.getByText("Conversations you start show up here.")).toBeDefined();
  expect(screen.queryAllByRole("heading")).toEqual([]);
});

it("never says Eve to the reader", () => {
  const { container } = renderRail();

  expect(within(container).queryByText(/\bEve\b/)).toBeNull();
});
