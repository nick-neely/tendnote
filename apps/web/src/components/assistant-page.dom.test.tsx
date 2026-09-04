// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import type { AssistantConversationView } from "@/app/actions/assistant-conversations";
import { render, screen, userEvent, waitFor, within } from "@/test/dom";

/**
 * jsdom computes no CSS, so both the wide-viewport controls and their phone
 * counterparts are in the tree at once. Queries that could match either are
 * scoped to the region that owns them.
 */
function header() {
  return within(screen.getByRole("banner"));
}

function rail() {
  return within(screen.getByRole("navigation", { name: "Conversations" }));
}

/**
 * What only the page can get wrong.
 *
 * The panel's own behaviour is covered in `assistant-panel.dom.test.tsx`; this
 * is about the seam around it — the conversation rail, and the one piece of
 * wiring that is genuinely load-bearing: a brand-new thread has to get its id
 * into the URL *without* remounting the panel that is mid-turn inside it, which
 * is why the panel is keyed on a client-owned thread key and the URL is updated
 * through the history API rather than the router.
 */

type ThreadResult =
  | { ok: true; view: AssistantConversationView | null }
  | { ok: false; error: string };

const { actions, panel, router, toast } = vi.hoisted(() => ({
  actions: {
    archive: vi.fn(async (): Promise<ThreadResult> => ({ ok: true, view: null })),
    list: vi.fn(
      async (): Promise<
        { ok: true; view: AssistantConversationView[] } | { ok: false; error: string }
      > => ({
        ok: true,
        view: [],
      }),
    ),
    record: vi.fn(async () => ({
      ok: true as const,
      view: { sessionId: "wrun_new", recorded: true },
    })),
    rename: vi.fn(async (): Promise<ThreadResult> => ({ ok: true, view: null })),
    unarchive: vi.fn(async (): Promise<ThreadResult> => ({ ok: true, view: null })),
  },
  panel: { mounts: [] as { key: string | null; initialSessionId?: string }[] },
  router: { push: vi.fn() },
  toast: { error: vi.fn() },
}));

vi.mock("@/app/actions/assistant-conversations", () => ({
  archiveAssistantConversationAction: actions.archive,
  listAssistantConversationsAction: actions.list,
  recordAssistantConversationAction: actions.record,
  renameAssistantConversationAction: actions.rename,
  unarchiveAssistantConversationAction: actions.unarchive,
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));

/**
 * The panel stands in for itself: what matters here is how many times it was
 * mounted and with what, plus a way to fire the "eve just named this session"
 * hand-off the real one makes from `onSessionChange`.
 */
vi.mock("@/components/assistant-panel", async () => {
  const { useEffect } = await import("react");
  return {
    AssistantPanel: ({
      initialSessionId,
      onSessionStarted,
    }: {
      initialSessionId?: string;
      onSessionStarted?: (sessionId: string, firstMessage: string) => void;
    }) => {
      useEffect(() => {
        panel.mounts.push({ initialSessionId, key: null });
      }, [initialSessionId]);
      return (
        <button
          onClick={() => onSessionStarted?.("wrun_new", "What's going on with Priya Shah lately?")}
          type="button"
        >
          {initialSessionId ? `resuming ${initialSessionId}` : "fresh panel"}
        </button>
      );
    },
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import { AssistantPage } from "./assistant-page";
import { AssistantPageFrame } from "./assistant-page-frame";

const CONVERSATIONS: AssistantConversationView[] = [
  {
    archived: false,
    lastActivityAt: new Date(),
    sessionId: "wrun_existing",
    title: "Notes on Jordan",
  },
];

beforeEach(() => {
  panel.mounts.length = 0;
  router.push.mockClear();
  for (const action of Object.values(actions)) action.mockClear();
  actions.list.mockReset();
  actions.record.mockReset();
  toast.error.mockClear();
  actions.list.mockResolvedValue({ ok: true, view: CONVERSATIONS });
  actions.record.mockResolvedValue({
    ok: true,
    view: { sessionId: "wrun_new", recorded: true },
  });
  // biome-ignore lint/suspicious/noDocumentCookie: reset the sidebar cookie between tests.
  document.cookie = "sidebar_state=true; path=/";
  window.localStorage.clear();
  window.history.replaceState(null, "", "/assistant");
});

/** The root layout's tooltip provider, which the rail's icon labels sit under. */
function page(props: Partial<Parameters<typeof AssistantPage>[0]> = {}) {
  return (
    <TooltipProvider>
      <AssistantPageFrame>
        <AssistantPage
          conversations={CONVERSATIONS}
          nudges={[]}
          ownerUserId="owner-1"
          sessionId={null}
          suggestPersonName={null}
          {...props}
        />
      </AssistantPageFrame>
    </TooltipProvider>
  );
}

function renderPage(sessionId: string | null = null) {
  return render(page({ sessionId }));
}

it("shows the owner's threads beside a fresh conversation", async () => {
  renderPage();

  expect(await screen.findByText("fresh panel")).toBeDefined();
  expect(rail().getByRole("link", { name: "Notes on Jordan" })).toBeDefined();
  expect(screen.getByRole("heading", { level: 1, name: "Assistant" })).toBeDefined();
});

it("reopens the thread the URL names", async () => {
  renderPage("wrun_existing");

  expect(await screen.findByText("resuming wrun_existing")).toBeDefined();
  expect(rail().getByRole("link", { name: "Notes on Jordan" }).getAttribute("aria-current")).toBe(
    "page",
  );
});

/**
 * The whole point of the history-API update. Putting the new id in the URL must
 * not remount the panel: `useEveAgent` reads its config once, so a remount here
 * would tear down the stream of the turn that is running.
 */
it("puts a new thread's id in the URL without restarting the conversation", async () => {
  renderPage();

  await screen.findByText("fresh panel");
  const mountsBefore = panel.mounts.length;

  await userEvent.click(screen.getByRole("button", { name: "fresh panel" }));

  await waitFor(() => expect(window.location.pathname).toBe("/assistant/wrun_new"));
  expect(panel.mounts.length).toBe(mountsBefore);
  expect(router.push).not.toHaveBeenCalled();
});

/**
 * The first rung of the title ladder (ADR 0238), seen from the rail: the owner's
 * own opening words stand in before the server has answered at all.
 */
it("shows a new thread at the top of the rail before the server answers", async () => {
  // A claim that never settles, so the optimistic row is what stays on screen.
  actions.record.mockReturnValue(new Promise(() => {}) as never);
  renderPage();

  await screen.findByText("fresh panel");
  await userEvent.click(screen.getByRole("button", { name: "fresh panel" }));

  const row = await screen.findByRole("link", {
    name: "What's going on with Priya Shah lately?",
  });
  expect(row.getAttribute("aria-current")).toBe("page");
  expect(actions.record).toHaveBeenCalledWith({
    firstMessage: "What's going on with Priya Shah lately?",
    sessionId: "wrun_new",
  });
});

/** And the server's answer wins from the moment it exists, model title included. */
it("takes the stored title over its own guess as soon as the row exists", async () => {
  actions.list.mockResolvedValue({
    ok: true,
    view: [
      {
        archived: false,
        lastActivityAt: new Date(),
        sessionId: "wrun_new",
        title: "Updates on Priya Shah",
      },
      ...CONVERSATIONS,
    ],
  });
  renderPage();

  await screen.findByText("fresh panel");
  await userEvent.click(screen.getByRole("button", { name: "fresh panel" }));

  const row = await screen.findByRole("link", { name: "Updates on Priya Shah" });
  expect(row.getAttribute("aria-current")).toBe("page");
});

/**
 * `runOwnerAction` returns a refusal as data, so the rail's job is to check it.
 * Applying a rename the server declined would leave the list asserting a name
 * that is not stored anywhere.
 */
it("keeps the stored title and speaks up when a rename is refused", async () => {
  actions.rename.mockResolvedValue({ ok: false, error: "You've reached a usage limit." });
  renderPage();
  await screen.findByText("fresh panel");

  await userEvent.click(rail().getByRole("button", { name: "Actions for Notes on Jordan" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  const field = screen.getByRole("textbox", { name: "Rename Notes on Jordan" });
  await userEvent.clear(field);
  await userEvent.type(field, "Jordan check-in{Enter}");

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've reached a usage limit."));
  expect(await rail().findByRole("link", { name: "Notes on Jordan" })).toBeDefined();
  expect(rail().queryByRole("link", { name: "Jordan check-in" })).toBeNull();
});

/** The row the server saved is what the rail shows, not the change that was asked for. */
it("takes the saved row from a rename rather than the typed title", async () => {
  actions.rename.mockResolvedValue({
    ok: true,
    view: {
      archived: false,
      lastActivityAt: new Date(),
      sessionId: "wrun_existing",
      title: "Jordan check-in",
    },
  });
  renderPage();
  await screen.findByText("fresh panel");

  await userEvent.click(rail().getByRole("button", { name: "Actions for Notes on Jordan" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  const field = screen.getByRole("textbox", { name: "Rename Notes on Jordan" });
  await userEvent.clear(field);
  await userEvent.type(field, "Jordan check-in{Enter}");

  expect(await rail().findByRole("link", { name: "Jordan check-in" })).toBeDefined();
  expect(toast.error).not.toHaveBeenCalled();
});

/**
 * `ok` with no row is the owner-scoped query matching nothing — the thread is
 * gone, or was never this owner's. Hiding it locally would be a lie; the repair
 * is to say so and re-read.
 */
it("re-reads the list rather than archiving a thread the server does not have", async () => {
  actions.archive.mockResolvedValue({ ok: true, view: null });
  renderPage();
  await screen.findByText("fresh panel");
  actions.list.mockClear();

  await userEvent.click(rail().getByRole("button", { name: "Actions for Notes on Jordan" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("That conversation is no longer here."),
  );
  expect(actions.list).toHaveBeenCalled();
  expect(rail().getByRole("link", { name: "Notes on Jordan" })).toBeDefined();
});

/**
 * Archiving is a round trip, not a local hide: the row the server saved is what
 * moves, which is what puts it in the Archived group rather than out of sight.
 */
it("moves a thread the server archived into the Archived group", async () => {
  actions.archive.mockResolvedValue({
    ok: true,
    view: {
      archived: true,
      lastActivityAt: new Date(),
      sessionId: "wrun_existing",
      title: "Notes on Jordan",
    },
  });
  renderPage();
  await screen.findByText("fresh panel");

  await userEvent.click(rail().getByRole("button", { name: "Actions for Notes on Jordan" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

  await waitFor(() => expect(rail().queryByRole("link", { name: "Notes on Jordan" })).toBeNull());
  await userEvent.click(rail().getByRole("button", { name: "Archived 1" }));
  expect(rail().getByRole("link", { name: "Notes on Jordan" })).toBeDefined();
  expect(toast.error).not.toHaveBeenCalled();
});

it("starts a new conversation on a panel that no longer holds the old session", async () => {
  renderPage("wrun_existing");

  await screen.findByText("resuming wrun_existing");
  await userEvent.click(rail().getByRole("button", { name: "New conversation" }));

  expect(await screen.findByText("fresh panel")).toBeDefined();
  expect(router.push).toHaveBeenCalledWith("/assistant");
});

/**
 * The fold is the sidebar's own cookie, read by the persistent frame.
 * What the page owes it is the two halves of that round trip: write
 * the cookie when the trigger is pressed, and start folded when it says so.
 */
it("writes the fold to the sidebar cookie and restores it before painting", async () => {
  const view = renderPage();
  await screen.findByText("fresh panel");
  expect(rail().getByRole("button", { name: "New conversation" })).toBeDefined();

  await userEvent.click(header().getByRole("button", { name: "Conversations" }));

  await waitFor(() => expect(document.cookie).toContain("sidebar_state=false"));

  view.unmount();
  render(page());
  await screen.findByText("fresh panel");

  // A folded rail is an icon rail, so the standing action moves to the header
  // rather than leaving the page with no way to start a conversation.
  expect(header().getByRole("button", { name: "New conversation" })).toBeDefined();
});

/**
 * Two controls the header used to carry and no longer does: the privacy chip
 * said the standing promise a second time, and the trace toggle was development
 * chrome sitting permanently in a product header.
 */
it("keeps the header down to who is talking and which thread", async () => {
  renderPage("wrun_existing");
  await screen.findByText("resuming wrun_existing");

  expect(header().getByText("Notes on Jordan")).toBeDefined();
  expect(header().queryByText("Private")).toBeNull();
  expect(header().queryByRole("button", { name: /trace|debug/i })).toBeNull();
});

it("never says Eve to the reader", async () => {
  renderPage();

  await screen.findByText("fresh panel");
  expect(document.body.textContent).not.toMatch(/\bEve\b/);
});
