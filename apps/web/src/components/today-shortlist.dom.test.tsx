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
    act: vi.fn(async () => ({ ...response(), items: response().items.slice(1) })),
    refresh: vi.fn(async () => response()),
    suppress: vi.fn(async () => ({ ...response(), items: response().items.slice(0, 1) })),
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
