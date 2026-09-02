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
  return within(screen.getByRole("complementary", { name: "Conversations" }));
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

const { actions, panel, router } = vi.hoisted(() => ({
  actions: {
    archive: vi.fn(async () => ({ ok: true as const, view: null })),
    list: vi.fn(async (): Promise<AssistantConversationView[]> => []),
    record: vi.fn(async () => ({ ok: true as const, view: { sessionId: "wrun_new" } })),
    rename: vi.fn(async () => ({ ok: true as const, view: null })),
    unarchive: vi.fn(async () => ({ ok: true as const, view: null })),
  },
  panel: { mounts: [] as { key: string | null; initialSessionId?: string }[] },
  router: { push: vi.fn() },
}));

vi.mock("@/app/actions/assistant-conversations", () => ({
  archiveAssistantConversationAction: actions.archive,
  listAssistantConversationsAction: actions.list,
  recordAssistantConversationAction: actions.record,
  renameAssistantConversationAction: actions.rename,
  unarchiveAssistantConversationAction: actions.unarchive,
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

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

import { AssistantPage } from "./assistant-page";

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
  actions.list.mockResolvedValue(CONVERSATIONS);
  actions.record.mockResolvedValue({ ok: true, view: { sessionId: "wrun_new" } });
  window.localStorage.clear();
  window.history.replaceState(null, "", "/assistant");
});

function renderPage(sessionId: string | null = null) {
  return render(
    <AssistantPage
      conversations={CONVERSATIONS}
      nudges={[]}
      ownerUserId="owner-1"
      sessionId={sessionId}
      suggestPersonName={null}
    />,
  );
}

it("shows the owner's threads beside a fresh conversation", async () => {
  renderPage();

  expect(await screen.findByText("fresh panel")).toBeDefined();
  expect(screen.getByRole("link", { name: "Notes on Jordan" })).toBeDefined();
  expect(screen.getByRole("heading", { level: 1, name: "Assistant" })).toBeDefined();
});

it("reopens the thread the URL names", async () => {
  renderPage("wrun_existing");

  expect(await screen.findByText("resuming wrun_existing")).toBeDefined();
  expect(screen.getByRole("link", { name: "Notes on Jordan" }).getAttribute("aria-current")).toBe(
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
  actions.list.mockResolvedValue([
    {
      archived: false,
      lastActivityAt: new Date(),
      sessionId: "wrun_new",
      title: "Updates on Priya Shah",
    },
    ...CONVERSATIONS,
  ]);
  renderPage();

  await screen.findByText("fresh panel");
  await userEvent.click(screen.getByRole("button", { name: "fresh panel" }));

  const row = await screen.findByRole("link", { name: "Updates on Priya Shah" });
  expect(row.getAttribute("aria-current")).toBe("page");
});

it("starts a new conversation on a panel that no longer holds the old session", async () => {
  renderPage("wrun_existing");

  await screen.findByText("resuming wrun_existing");
  await userEvent.click(rail().getByRole("button", { name: "New conversation" }));

  expect(await screen.findByText("fresh panel")).toBeDefined();
  expect(router.push).toHaveBeenCalledWith("/assistant");
});

it("remembers a folded rail on this device", async () => {
  const view = renderPage();
  await screen.findByText("fresh panel");

  await userEvent.click(header().getByRole("button", { name: "Hide conversations" }));
  expect(header().getByRole("button", { name: "Show conversations" })).toBeDefined();

  view.unmount();
  renderPage();

  await waitFor(() =>
    expect(header().getByRole("button", { name: "Show conversations" })).toBeDefined(),
  );
});

it("never says Eve to the reader", async () => {
  renderPage();

  await screen.findByText("fresh panel");
  expect(document.body.textContent).not.toMatch(/\bEve\b/);
});
