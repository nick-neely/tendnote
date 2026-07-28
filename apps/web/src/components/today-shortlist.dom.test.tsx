// @vitest-environment jsdom
import type { TodayShortlistResponse } from "@tendnote/domain/today";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

vi.mock("next/link", () => import("@/test/next-link-mock"));
const routerRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

import { TodayShortlist, type TodayShortlistHandlers } from "./today-shortlist";

const FOLLOWUP_ID = "11111111-1111-1111-1111-111111111111";

function response(): TodayShortlistResponse {
  return {
    items: [
      {
        identity: `follow_up:${FOLLOWUP_ID}`,
        family: "follow_up",
        record: {
          kind: "follow_up",
          id: FOLLOWUP_ID,
          href: `/people/person-1#followup-${FOLLOWUP_ID}`,
        },
        title: "Call Sam",
        context: "Sam · Follow-Up",
        reason: { code: "overdue", key: "due:jul-20", explanation: "Overdue since Jul 20." },
        sourceRefs: [{ kind: "followup", id: FOLLOWUP_ID }],
        action: { kind: "complete_follow_up", label: "Complete" },
        mandatory: true,
        dueAt: new Date("2026-07-20T09:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        sensitivity: "normal",
      },
      {
        identity: "saved_item:filter",
        family: "saved_item",
        record: { kind: "saved_item", id: "filter", href: "/saved-items#saved-item-filter" },
        title: "Filter measurements",
        context: "Saved note",
        reason: {
          code: "bring_back_arrived",
          key: "bring-back:jul-21",
          explanation: "Set to return Jul 21.",
        },
        sourceRefs: [
          { kind: "saved_item", id: "filter" },
          { kind: "source_record", id: "source-1" },
        ],
        action: { kind: "open_record", label: "Open" },
        mandatory: false,
        dueAt: new Date("2026-07-21T09:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        sensitivity: "normal",
      },
    ],
    candidateFingerprint: "fingerprint",
    curation: "deterministic",
    overflow: null,
    limitations: [],
  };
}

function handlers(): TodayShortlistHandlers {
  return {
    act: vi.fn(async () => ({
      ok: true as const,
      view: { ...response(), items: response().items.slice(1) },
    })),
    refresh: vi.fn(async () => ({ ok: true as const, view: response() })),
    restore: vi.fn(async () => ({ ok: true as const, view: response() })),
    suppress: vi.fn(async () => ({
      ok: true as const,
      view: { ...response(), items: response().items.slice(1) },
    })),
  };
}

describe("TodayShortlist", () => {
  beforeEach(() => routerRefresh.mockClear());
  afterEach(() => vi.useRealTimers());

  it("renders flat explainable rows with real actions and a labelled More menu", async () => {
    const user = userEvent.setup();
    const actions = handlers();
    render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText("Follow-Up")).toBeTruthy();
    expect(screen.getByText("Sam · Follow-Up")).toBeTruthy();
    expect(screen.getByText("Why today: Overdue since Jul 20.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Filter measurements" }).getAttribute("href")).toBe(
      "/saved-items#saved-item-filter",
    );

    await user.click(screen.getByRole("button", { name: "More options for Call Sam" }));
    expect(screen.getByRole("menuitem", { name: "Open record" }).className).toContain("min-h-11");
    expect(screen.getByRole("menuitem", { name: "Later" }).className).toContain("min-h-11");
    expect(screen.getByRole("menuitem", { name: "Not today" }).className).toContain("min-h-11");
    await user.click(screen.getByRole("menuitem", { name: "Not today" }));

    await waitFor(() =>
      expect(actions.suppress).toHaveBeenCalledWith({
        localDate: "2026-07-21",
        candidateIdentity: `follow_up:${FOLLOWUP_ID}`,
        reasonKey: "due:jul-20",
        kind: "not_today",
        suppressUntil: null,
      }),
    );
  });

  it("uses the backing domain completion action instead of a generic Today mutation", async () => {
    const user = userEvent.setup();
    const actions = handlers();
    render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Complete Call Sam" }));

    await waitFor(() =>
      expect(actions.act).toHaveBeenCalledWith({
        localDate: "2026-07-21",
        candidateIdentity: `follow_up:${FOLLOWUP_ID}`,
        reasonKey: "due:jul-20",
      }),
    );
  });

  it("projects Not today immediately and restores through authoritative Undo", async () => {
    const user = userEvent.setup();
    const actions = handlers();
    render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    await user.click(screen.getByRole("button", { name: "More options for Call Sam" }));
    await user.click(screen.getByRole("menuitem", { name: "Not today" }));

    expect(screen.queryByRole("link", { name: "Call Sam" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Undo Not today" }));

    await waitFor(() => expect(actions.restore).toHaveBeenCalledOnce());
    expect(await screen.findByRole("link", { name: "Call Sam" })).toBeTruthy();
  });

  it("rolls a failed suppression back to the exact row and stable More control", async () => {
    const user = userEvent.setup();
    const actions = handlers();
    vi.mocked(actions.suppress).mockResolvedValue({
      ok: false,
      error: "Today changed elsewhere.",
    });
    render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    await user.click(screen.getByRole("button", { name: "More options for Call Sam" }));
    await user.click(screen.getByRole("menuitem", { name: "Not today" }));

    const restoredControl = await screen.findByRole("button", {
      name: "More options for Call Sam",
    });
    await waitFor(() => expect(document.activeElement).toBe(restoredControl));
    expect(screen.getByRole("alert").textContent).toContain("Today changed elsewhere.");
  });

  it("keeps unrelated rows usable and exposes visible pending state", async () => {
    const user = userEvent.setup();
    const actions = handlers();
    let settle: (result: Awaited<ReturnType<TodayShortlistHandlers["suppress"]>>) => void =
      () => {};
    vi.mocked(actions.suppress).mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    await user.click(screen.getByRole("button", { name: "More options for Call Sam" }));
    await user.click(screen.getByRole("menuitem", { name: "Not today" }));

    expect(screen.getByRole("region", { name: "Today shortlist" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(screen.getAllByText("Removing item from Today…").length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("button", { name: "More options for Filter measurements" })
        .hasAttribute("disabled"),
    ).toBe(false);

    settle({ ok: true, view: { ...response(), items: response().items.slice(1) } });
    await waitFor(() => expect(screen.queryAllByText("Removing item from Today…")).toHaveLength(0));
  });

  it("composes concurrent suppressions without hiding feedback or resurrecting rows", async () => {
    const user = userEvent.setup();
    const actions = handlers();
    const settlers = new Map<
      string,
      (result: Awaited<ReturnType<TodayShortlistHandlers["suppress"]>>) => void
    >();
    vi.mocked(actions.suppress).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          settlers.set(input.candidateIdentity, resolve);
        }),
    );
    render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    await user.click(screen.getByRole("button", { name: "More options for Call Sam" }));
    await user.click(screen.getByRole("menuitem", { name: "Not today" }));
    await user.click(screen.getByRole("button", { name: "More options for Filter measurements" }));
    await user.click(screen.getByRole("menuitem", { name: "Not today" }));

    expect(screen.getAllByText("Removing item from Today…")).toHaveLength(3);
    settlers.get("saved_item:filter")?.({
      ok: true,
      view: { ...response(), items: response().items.slice(0, 1) },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Today shortlist" }).getAttribute("aria-busy"),
      ).toBe("true"),
    );
    settlers.get(`follow_up:${FOLLOWUP_ID}`)?.({
      ok: true,
      view: { ...response(), items: response().items.slice(1) },
    });

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Undo Not today" })).toHaveLength(2),
    );
    expect(screen.queryByRole("link", { name: "Call Sam" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Filter measurements" })).toBeNull();
    expect(screen.getByRole("region", { name: "Today shortlist" }).getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it("restores a failed Later submit to the initiating Set button", async () => {
    const user = userEvent.setup();
    const actions = handlers();
    vi.mocked(actions.suppress).mockResolvedValue({
      ok: false,
      error: "Today changed elsewhere.",
    });
    render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    await user.click(screen.getByRole("button", { name: "More options for Call Sam" }));
    await user.click(screen.getByRole("menuitem", { name: "Later" }));
    await user.click(screen.getByRole("button", { name: "Set" }));

    const restoredSubmit = await screen.findByRole("button", { name: "Set" });
    await waitFor(() => expect(document.activeElement).toBe(restoredSubmit));
  });

  it("moves focus to a logical sibling and then the heading when rows leave", async () => {
    const user = userEvent.setup();
    const actions = handlers();
    const view = render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    await user.click(screen.getByRole("button", { name: "More options for Call Sam" }));
    await user.click(screen.getByRole("menuitem", { name: "Not today" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("link", { name: "Filter measurements" }),
      ),
    );

    const lastOnly = { ...response(), items: response().items.slice(1) };
    view.rerender(
      <TodayShortlist
        handlers={actions}
        initial={lastOnly}
        localDate="2026-07-22"
        timeZone="America/Chicago"
      />,
    );
    vi.mocked(actions.suppress).mockResolvedValue({ ok: true, view: { ...lastOnly, items: [] } });
    await user.click(screen.getByRole("button", { name: "More options for Filter measurements" }));
    await user.click(screen.getByRole("menuitem", { name: "Not today" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Worth your attention" }),
      ),
    );
  });

  it("resets candidates and response metadata when the authoritative day changes", () => {
    const actions = handlers();
    const view = render(
      <TodayShortlist
        handlers={actions}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );
    const next = {
      ...response(),
      items: response()
        .items.slice(0, 1)
        .map((item) => ({ ...item, title: "Call Sam tomorrow" })),
      limitations: ["Calendar is still syncing."],
    };

    view.rerender(
      <TodayShortlist
        handlers={actions}
        initial={next}
        localDate="2026-07-22"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.queryByRole("link", { name: "Call Sam" })).toBeNull();
    expect(screen.getByRole("link", { name: "Call Sam tomorrow" })).toBeTruthy();
    expect(screen.getByText("Calendar is still syncing.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Filter measurements" })).toBeNull();
  });

  it("opens the explicit Later control and links mandatory overflow to its real domains", async () => {
    const user = userEvent.setup();
    const overflowResponse: TodayShortlistResponse = {
      ...response(),
      overflow: {
        mandatoryCount: 7,
        omittedCount: 2,
        destinations: [
          { family: "follow_up", label: "People", href: "/people" },
          { family: "action", label: "Actions", href: "/actions" },
        ],
      },
    };
    render(
      <TodayShortlist
        handlers={handlers()}
        initial={overflowResponse}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    await user.click(screen.getByRole("button", { name: "More options for Call Sam" }));
    await user.click(screen.getByRole("menuitem", { name: "Later" }));

    expect(screen.getByLabelText("Show again")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "People" }).getAttribute("href")).toBe("/people");
    expect(screen.getByRole("link", { name: "Actions" }).getAttribute("href")).toBe("/actions");
  });

  it("refreshes the authoritative page when an open visit crosses the owner local day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T05:01:00.000Z"));
    render(
      <TodayShortlist
        handlers={handlers()}
        initial={response()}
        localDate="2026-07-21"
        timeZone="America/Chicago"
      />,
    );

    expect(routerRefresh).toHaveBeenCalledOnce();
  });
});
