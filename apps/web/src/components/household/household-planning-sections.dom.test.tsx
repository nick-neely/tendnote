// @vitest-environment jsdom
import type { CalendarEventSummary } from "@tendnote/domain";
import type { HouseholdCalendarRead } from "@tendnote/domain/household-calendar";
import type { HouseholdEventPlan } from "@tendnote/domain/household-event-plans";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, userEvent, waitFor, within } from "@/test/dom";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// Every panel imports its server actions as defaults and every test injects its
// own, so the real (server-only) modules must never be pulled in.
vi.mock("@/app/actions/households", () => ({ createHouseholdAction: vi.fn() }));
vi.mock("@/app/actions/household-invitations", () => ({
  sendHouseholdInvitationAction: vi.fn(),
  resendHouseholdInvitationAction: vi.fn(),
  cancelHouseholdInvitationAction: vi.fn(),
}));
vi.mock("@/app/actions/household-governance", () => ({
  offerHouseholdOwnerRoleAction: vi.fn(),
  withdrawHouseholdOwnerOfferAction: vi.fn(),
  acceptHouseholdOwnerRoleAction: vi.fn(),
  declineHouseholdOwnerRoleAction: vi.fn(),
  stepDownFromHouseholdOwnerAction: vi.fn(),
  removeHouseholdMemberAction: vi.fn(),
  leaveHouseholdAction: vi.fn(),
  confirmHouseholdDissolutionAction: vi.fn(),
  cancelHouseholdDissolutionAction: vi.fn(),
}));
vi.mock("@/app/actions/household-calendar", () => ({
  connectHouseholdCalendarAction: vi.fn(),
  disconnectHouseholdCalendarAction: vi.fn(),
}));
vi.mock("@/app/actions/household-event-plans", () => ({
  createHouseholdEventPlanAction: vi.fn(),
  updateHouseholdEventPlanAction: vi.fn(),
  archiveHouseholdEventPlanAction: vi.fn(),
  restoreHouseholdEventPlanAction: vi.fn(),
  linkHouseholdEventPlanRecordAction: vi.fn(),
  unlinkHouseholdEventPlanRecordAction: vi.fn(),
}));

import type { HouseholdCalendarActions } from "@/components/household/household-calendars-panel";
import type { HouseholdEventPlanActions } from "@/components/household/household-event-plans-panel";
import { HouseholdPlanningSections } from "@/components/household/household-planning-sections";
import type {
  HouseholdEventPlanLinkCandidate,
  HouseholdEventPlanRecord,
} from "@/lib/household/household-event-plan-view";

const NOW = new Date("2026-08-09T09:00:00Z");

const MEMBERS = [
  { userId: "ana", name: "Ana" },
  { userId: "ben", name: "Ben" },
];

function event(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: "event-1",
    calendarId: "primary",
    title: "School concert",
    start: new Date("2026-08-11T18:30:00Z"),
    end: new Date("2026-08-11T20:00:00Z"),
    allDay: false,
    status: "confirmed",
    attendees: [],
    location: null,
    description: null,
    updatedAt: null,
    ...overrides,
  };
}

function plan(overrides: Partial<HouseholdEventPlan> = {}): HouseholdEventPlan {
  return {
    id: "plan-1",
    householdId: "household-1",
    createdByUserId: "ana",
    lastActorUserId: "ana",
    title: "School night supper",
    details: null,
    plannedFor: null,
    status: "active",
    archivedAt: null,
    calendarConnectionId: null,
    calendarId: null,
    calendarProviderEventId: null,
    version: 1,
    createdAt: new Date("2026-08-01T09:00:00Z"),
    updatedAt: new Date("2026-08-01T09:00:00Z"),
    ...overrides,
  };
}

/** A Plan as the server hands it over, with the links this reader was proved for. */
function record(
  plan: HouseholdEventPlan,
  links: HouseholdEventPlanRecord["links"] = [],
): HouseholdEventPlanRecord {
  return { plan, links };
}

const CANDIDATES: HouseholdEventPlanLinkCandidate[] = [
  { kind: "general_action", id: "action-1", title: "Bring the folding chairs" },
  { kind: "followup", id: "followup-1", title: "Ask about the recital" },
  { kind: "saved_item", id: "saved-1", title: "The good potato recipe" },
];

const CONNECTION = {
  id: "connection-1",
  label: "Family calendar",
  calendarId: "primary",
  connectorUserId: "ana",
  designatedByUserId: "ana",
  connectedAt: new Date("2026-08-01T09:00:00Z"),
};

function read(
  families: HouseholdCalendarRead["families"] = [
    {
      connectionId: "connection-1",
      label: "Family calendar",
      state: "events",
      stale: false,
      fetchedAt: NOW,
      events: [event()],
    },
  ],
): HouseholdCalendarRead {
  return { families };
}

function renderShared(
  overrides: {
    viewerRole?: "owner" | "member";
    viewerUserId?: string;
    calendars?: { connections: (typeof CONNECTION)[]; read: HouseholdCalendarRead } | null;
    plans?: HouseholdEventPlanRecord[] | null;
    linkCandidates?: HouseholdEventPlanLinkCandidate[];
    viewerHasCalendarAccess?: boolean;
    calendarActions?: HouseholdCalendarActions;
    planActions?: HouseholdEventPlanActions;
  } = {},
) {
  return render(
    <HouseholdPlanningSections
      calendarActions={overrides.calendarActions}
      calendars={
        overrides.calendars === undefined
          ? { connections: [CONNECTION], read: read() }
          : overrides.calendars
      }
      linkCandidates={overrides.linkCandidates ?? CANDIDATES}
      members={MEMBERS}
      now={NOW}
      planActions={overrides.planActions}
      plans={overrides.plans === undefined ? [record(plan())] : overrides.plans}
      viewerHasCalendarAccess={overrides.viewerHasCalendarAccess ?? true}
      viewerRole={overrides.viewerRole ?? "owner"}
      viewerUserId={overrides.viewerUserId ?? "ana"}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Who sees what. The privacy contract is that every active member reads the
 * designated calendars and the Plans, and only an Owner may change what is
 * shared with the whole household.
 */
describe("the multi-member matrix", () => {
  it("gives an owner the household's shared content and the controls over it", () => {
    renderShared({ viewerRole: "owner" });

    expect(screen.getByRole("heading", { name: /Shared calendars/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Event plans/ })).toBeTruthy();
    expect(screen.getByText("School concert")).toBeTruthy();
    expect(screen.getByText("School night supper")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share a calendar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeTruthy();
  });

  /**
   * A member reads the same calendars and Plans and holds the same authority
   * over a Plan. What they do not get is the pair of controls that change what
   * the whole household can read.
   */
  it("gives a member the same reading and the same plan authority, minus the governance", () => {
    renderShared({ viewerRole: "member" });

    expect(screen.getByText("School concert")).toBeTruthy();
    expect(screen.getByText("School night supper")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Share a calendar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop sharing" })).toBeNull();
  });
});

describe("shared calendars", () => {
  /** Provider-derived context carries no affordance that could change it. */
  it("offers nothing on an event but a way to plan beside it", () => {
    renderShared();

    const row = screen.getByText("School concert").closest("li");
    const controls = within(row as HTMLElement)
      .queryAllByRole("button")
      .map((button) => button.textContent);
    expect(controls).toEqual(["Plan this event"]);
    expect(screen.getByText(/never adds, changes, cancels, or replies/i)).toBeTruthy();
  });

  /**
   * The Phase Eight contract's hardest requirement: one failing calendar hides
   * neither a working calendar nor the Plans.
   */
  it("isolates a calendar that cannot be read from the rest of the surface", () => {
    renderShared({
      calendars: {
        connections: [CONNECTION],
        read: read([
          { connectionId: "connection-1", label: "Family calendar", state: "unavailable" },
          {
            connectionId: "connection-2",
            label: "School calendar",
            state: "events",
            stale: false,
            fetchedAt: NOW,
            events: [event({ providerEventId: "event-2", title: "Parents' evening" })],
          },
        ]),
      },
    });

    expect(screen.getByText(/This calendar can.t be read right now/i)).toBeTruthy();
    expect(screen.getByText("Parents' evening")).toBeTruthy();
    expect(screen.getByText("School night supper")).toBeTruthy();
  });

  it("says a calendar is showing out-of-date provider data", () => {
    renderShared({
      calendars: {
        connections: [CONNECTION],
        read: read([
          {
            connectionId: "connection-1",
            label: "Family calendar",
            state: "events",
            stale: true,
            fetchedAt: new Date("2026-08-09T06:00:00Z"),
            events: [event()],
          },
        ]),
      },
    });

    expect(screen.getByText(/Showing what was last read/i).textContent).toMatch(
      /3h ago.*may be out of date/i,
    );
  });

  /**
   * Connecting changes what every current and future member can read, so the
   * confirmation is the thing that unlocks the press rather than a sentence
   * beside it.
   */
  it("will not share a calendar until an owner has confirmed the whole household", async () => {
    const connect = vi
      .fn()
      .mockResolvedValue({ ok: true, view: { connections: [CONNECTION], read: read() } });
    renderShared({ calendarActions: { connect }, calendars: { connections: [], read: read([]) } });

    await userEvent.click(screen.getByRole("button", { name: "Share a calendar" }));
    await userEvent.type(screen.getByLabelText("What the household will call it"), "Family");

    const share = screen.getByRole("button", { name: "Share this calendar" });
    expect(share.hasAttribute("disabled")).toBe(true);

    const confirmation = screen.getByLabelText(
      /Everyone in this household, now and anyone who joins later, will be able to read/i,
    );
    await userEvent.click(confirmation);
    await userEvent.click(screen.getByRole("button", { name: "Share this calendar" }));

    await waitFor(() => {
      expect(connect).toHaveBeenCalledWith({ label: "Family" });
    });
    expect(
      screen.getAllByRole("status").some((region) => region.textContent?.includes("Family")),
    ).toBe(true);
    // The credential stays with the connector, and the form says so.
    expect(screen.queryByText(/gains access to your account/i)).toBeNull();
  });

  /** An honest next step, never a control that would only refuse. */
  it("tells an owner with no Google Calendar of their own what to do first", () => {
    renderShared({
      calendars: { connections: [], read: read([]) },
      viewerHasCalendarAccess: false,
    });

    expect(screen.queryByRole("button", { name: "Share a calendar" })).toBeNull();
    expect(screen.getByText(/yours isn.t connected yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect it in Account" }).getAttribute("href")).toBe(
      "/account",
    );
  });

  it("says what stopping sharing costs before it happens", async () => {
    const disconnect = vi
      .fn()
      .mockResolvedValue({ ok: true, view: { connections: [], read: read([]) } });
    renderShared({ calendarActions: { disconnect } });

    await userEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(screen.getByText(/Everyone here stops seeing its events/i).textContent).toMatch(
      /will say the calendar isn.t available/i,
    );
    expect(disconnect).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Yes, stop sharing" }));

    await waitFor(() => {
      expect(disconnect).toHaveBeenCalledWith({ connectionId: "connection-1" });
    });
    expect(screen.getByText(/No calendar is shared with this household yet/i)).toBeTruthy();
  });

  /**
   * Both of these presses destroy the control that was focused, so without an
   * explicit move the caret lands on the document body at the moment there is
   * something to do. The Plan side of this commit already does it; these two
   * are here so the section cannot drift back apart.
   */
  it("moves focus into the share form when it opens", async () => {
    renderShared({ calendars: { connections: [], read: read([]) } });

    await userEvent.click(screen.getByRole("button", { name: "Share a calendar" }));

    expect(document.activeElement).toBe(screen.getByLabelText("What the household will call it"));
  });

  it("moves focus onto the confirm control when stopping sharing asks twice", async () => {
    renderShared({});

    await userEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Yes, stop sharing" }));
  });

  /**
   * Provenance, not authority. A member reading an unattributed label cannot
   * tell whose calendar is in front of them, and an unreadable one leaves
   * nobody to ask.
   */
  it("names who shared each calendar", () => {
    renderShared({});

    expect(screen.getByText(/Shared by/i)).toBeTruthy();
  });
});

describe("event plans", () => {
  it("teaches the next action without asking anyone to feel behind", () => {
    renderShared({ plans: [] });

    expect(screen.getByText(/Nothing planned here yet/i).textContent).toMatch(
      /next birthday, school night, or visit/i,
    );
  });

  it("reads a plan's provenance as plain fact, and never as a feed", () => {
    renderShared({
      plans: [
        record(
          plan({
            lastActorUserId: "ben",
            version: 2,
            updatedAt: new Date("2026-08-09T18:30:00Z"),
          }),
        ),
      ],
      viewerUserId: "ana",
    });

    const card = screen.getByText("School night supper").closest("li");
    expect(within(card as HTMLElement).getByText(/Started by you/i)).toBeTruthy();
    expect(within(card as HTMLElement).getByText(/changed by Ben/i)).toBeTruthy();
    expect(within(card as HTMLElement).getByText(/Aug 9, 6:30 PM/)).toBeTruthy();
  });

  /**
   * A Plan created from a calendar event carries the event's address and none of
   * its wording, so it is a companion rather than a copy.
   */
  it("plans an event without copying anything the provider wrote", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: true,
      view: {
        outcome: "saved",
        plans: [
          record(
            plan({
              title: "Bring a dish",
              calendarConnectionId: "connection-1",
              calendarId: "primary",
              calendarProviderEventId: "event-1",
            }),
          ),
        ],
      },
    });
    renderShared({ planActions: { create }, plans: [] });

    await userEvent.click(screen.getByRole("button", { name: "Plan this event" }));

    const title = screen.getByLabelText("What is it") as HTMLInputElement;
    expect(title.value).toBe("");
    expect(document.activeElement).toBe(title);
    expect(screen.getByText(/give it a name in your own words/i)).toBeTruthy();

    await userEvent.type(title, "Bring a dish");
    await userEvent.click(screen.getByRole("button", { name: "Add plan" }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        draft: {
          title: "Bring a dish",
          details: null,
          plannedFor: null,
          calendarEvent: {
            connectionId: "connection-1",
            calendarId: "primary",
            providerEventId: "event-1",
          },
        },
      });
    });
    // The calendar row now says a plan exists rather than offering a second one.
    expect(screen.queryByRole("button", { name: "Plan this event" })).toBeNull();
    expect(screen.getByText("Has a plan")).toBeTruthy();
  });

  it("shows a plan's referenced event, and says plainly when it cannot", () => {
    renderShared({
      plans: [
        record(
          plan({
            calendarConnectionId: "connection-1",
            calendarId: "primary",
            calendarProviderEventId: "event-1",
          }),
        ),
        record(
          plan({
            id: "plan-2",
            title: "Cousins visiting",
            calendarConnectionId: "connection-9",
            calendarId: "primary",
            calendarProviderEventId: "event-9",
          }),
        ),
      ],
    });

    const live = screen.getByText("School night supper").closest("li");
    expect(within(live as HTMLElement).getByText("Tue 6:30 PM")).toBeTruthy();
    expect(within(live as HTMLElement).getByText("on Family calendar")).toBeTruthy();

    const lost = screen.getByText("Cousins visiting").closest("li");
    expect(
      within(lost as HTMLElement).getByText(/The calendar this refers to isn.t available/i),
    ).toBeTruthy();
  });

  it("keeps the household's own date apart from the provider's", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ ok: true, view: { outcome: "saved", plans: [record(plan())] } });
    renderShared({ planActions: { create }, plans: [] });

    await userEvent.click(screen.getByRole("button", { name: "New plan" }));
    await userEvent.type(screen.getByLabelText("What is it"), "Supper");
    fireEvent.change(screen.getByLabelText("When (optional)"), {
      target: { value: "2026-08-15" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add plan" }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        draft: {
          title: "Supper",
          details: null,
          plannedFor: "2026-08-15",
          calendarEvent: null,
        },
      });
    });
  });

  /** Archive is the removal path, and it is the only one anybody gets. */
  it("puts a plan away and brings it back, with no way to delete one", async () => {
    const archive = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "saved", plans: [record(plan({ status: "archived", version: 2 }))] },
    });
    const restore = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "saved", plans: [record(plan({ version: 3 }))] },
    });
    renderShared({ planActions: { archive, restore } });

    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Archived" })).toBeTruthy();
    });
    expect(archive).toHaveBeenCalledWith({ planId: "plan-1", expectedVersion: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith({ planId: "plan-1", expectedVersion: 2 });
    });
  });

  /** No RSVP, guest list, availability, attendance, assignee, or reminder. */
  it("offers nothing that would make a plan a claim about people", () => {
    renderShared();

    const card = screen.getByText("School night supper").closest("li") as HTMLElement;
    expect(
      within(card)
        .queryAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Edit", "Archive", "Link a record"]);
    expect(card.textContent).not.toMatch(/rsvp|going|attend|remind|assign/i);
  });
});

/**
 * A Plan may point at records the household already keeps. The whole contract is
 * that pointing changes nothing: the record carries on as it was, and finishing
 * it neither closes the Plan nor touches the calendar event beside it.
 */
describe("linking existing records to a plan", () => {
  const LINKED = {
    id: "link-1",
    linkKind: "general_action" as const,
    recordId: "action-1",
    title: "Bring the folding chairs",
  };

  function planCard(): HTMLElement {
    return screen.getByText("School night supper").closest("li") as HTMLElement;
  }

  /** A link reads as the record it points at, with its family said quietly beside it. */
  it("shows a linked record by name, and never by id", () => {
    renderShared({ plans: [record(plan(), [LINKED])] });

    const card = planCard();
    expect(within(card).getByText("Bring the folding chairs")).toBeTruthy();
    expect(within(card).getByText("Action")).toBeTruthy();
    expect(card.textContent).not.toMatch(/action-1|link-1/);
  });

  it("opens the picker in place, puts the reader in it, and links what they press", async () => {
    const link = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "saved", plans: [record(plan(), [LINKED])] },
    });
    renderShared({ planActions: { link } });

    await userEvent.click(screen.getByRole("button", { name: "Link a record" }));

    // Focus arrives with the picker, the way it does for a new plan and for the
    // conflict block: the press that opened it can be well above where it lands.
    const lead = screen.getByText(/Point this plan at something you.re already keeping/i);
    expect(document.activeElement).toBe(lead);
    // No modal took the screen over.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText(/Finishing one doesn.t change this plan or the event it refers to/i),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Link Bring the folding chairs" }));

    await waitFor(() => {
      expect(link).toHaveBeenCalledWith({
        planId: "plan-1",
        linkKind: "general_action",
        recordId: "action-1",
      });
    });
    expect(within(planCard()).getByText("Bring the folding chairs")).toBeTruthy();
  });

  /** Offering a record the Plan already holds would be offering a press that does nothing. */
  it("leaves out what the plan already links, and the family it empties", async () => {
    renderShared({ plans: [record(plan(), [LINKED])] });

    await userEvent.click(screen.getByRole("button", { name: "Link a record" }));

    expect(screen.queryByRole("button", { name: "Link Bring the folding chairs" })).toBeNull();
    expect(screen.queryByText("Action")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link Ask about the recital" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link The good potato recipe" })).toBeTruthy();
  });

  it("removes a link without touching the record it pointed at", async () => {
    const unlink = vi
      .fn()
      .mockResolvedValue({ ok: true, view: { outcome: "saved", plans: [record(plan())] } });
    renderShared({ planActions: { unlink }, plans: [record(plan(), [LINKED])] });

    await userEvent.click(screen.getByRole("button", { name: "Remove Bring the folding chairs" }));

    await waitFor(() => {
      expect(unlink).toHaveBeenCalledWith({ planId: "plan-1", linkId: "link-1" });
    });
    expect(within(planCard()).queryByText("Bring the folding chairs")).toBeNull();
    expect(
      screen.getAllByRole("status").some((region) => region.textContent?.includes("no longer")),
    ).toBe(true);
  });

  /** An honest sentence rather than a control that could only refuse. */
  it("says a full plan is full instead of offering another link", () => {
    const links = Array.from({ length: 12 }, (_, index) => ({
      id: `link-${index}`,
      linkKind: "general_action" as const,
      recordId: `action-${index}`,
      title: `Job ${index}`,
    }));
    renderShared({ plans: [record(plan(), links)] });

    expect(screen.queryByRole("button", { name: "Link a record" })).toBeNull();
    expect(screen.getByText(/holding all the records it can/i).textContent).toMatch(
      /Remove one to link something else/i,
    );
  });

  it("teaches the next step to a member with nothing to link yet", async () => {
    renderShared({ linkCandidates: [] });

    await userEvent.click(screen.getByRole("button", { name: "Link a record" }));

    expect(screen.getByText(/Nothing to link yet/i).textContent).toMatch(
      /Actions, follow-ups, and saved items you keep will show up here/i,
    );
  });

  /**
   * The proof engine's one opaque refusal - "not allowed", "never existed", and
   * "you were removed" alike - reaches the member as a sentence in place.
   */
  it("renders a refusal beside the plan rather than losing it", async () => {
    const link = vi.fn().mockResolvedValue({ ok: false, error: "That's no longer available." });
    renderShared({ planActions: { link } });

    await userEvent.click(screen.getByRole("button", { name: "Link a record" }));
    await userEvent.click(screen.getByRole("button", { name: "Link Bring the folding chairs" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("That's no longer available.");
    });
  });

  /** Archived is read-only, so its links stay legible and its controls go away. */
  it("keeps an archived plan's links readable and offers nothing to change them", () => {
    renderShared({ plans: [record(plan({ status: "archived" }), [LINKED])] });

    const card = screen.getByText("School night supper").closest("li") as HTMLElement;
    expect(within(card).getByText("Bring the folding chairs")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /Remove Bring/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Link a record" })).toBeNull();
  });
});

/**
 * The contract this section exists for: a member whose save was written against
 * a value someone else has since changed keeps their draft, is shown what beat
 * them and who wrote it, and chooses what happens next themselves.
 */
describe("two people writing at once", () => {
  const CONFLICT_MESSAGE =
    "Someone else changed this plan while you were writing. Your draft is kept below.";

  const beatenBy = plan({
    title: "Supper at Ana's",
    details: "Bring the good plates",
    lastActorUserId: "ben",
    version: 4,
    updatedAt: new Date("2026-08-09T18:30:00Z"),
  });

  /**
   * The notice is also announced, so the same sentence is on the screen twice.
   * This is the one a sighted reader sees.
   */
  function visibleConflictNotice(): HTMLElement {
    const notice = screen
      .getAllByText(CONFLICT_MESSAGE)
      .find((element) => !element.classList.contains("sr-only"));
    if (!notice) throw new Error("No visible conflict notice");
    return notice;
  }

  async function openEditAndSave(update: NonNullable<HouseholdEventPlanActions["update"]>) {
    renderShared({ planActions: { update }, viewerUserId: "ana" });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const title = screen.getByLabelText("What is it");
    await userEvent.clear(title);
    await userEvent.type(title, "Supper here");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  }

  it("keeps the draft and shows the value that beat it, with who wrote it and when", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "conflict", message: CONFLICT_MESSAGE, current: beatenBy },
    });
    await openEditAndSave(update);

    const notice = await waitFor(visibleConflictNotice);
    // The reader is put where the explanation is, not left on a field.
    expect(document.activeElement).toBe(notice);
    expect((screen.getByLabelText("What is it") as HTMLInputElement).value).toBe("Supper here");
    expect(screen.getByText(/It now reads/).textContent).toMatch(/Supper at Ana's/);
    expect(screen.getByText("Bring the good plates")).toBeTruthy();
    expect(screen.getByText(/Changed by Ben/).textContent).toMatch(/Aug 9, 6:30 PM/);
    // Three choices, and no way to save into the fence they just lost.
    expect(screen.getByRole("button", { name: "Save mine over theirs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep editing mine" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use their version" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("replaces only when the member says so, and against the version they were shown", async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        view: { outcome: "conflict", message: CONFLICT_MESSAGE, current: beatenBy },
      })
      .mockResolvedValueOnce({
        ok: true,
        view: { outcome: "saved", plans: [record(plan({ title: "Supper here", version: 5 }))] },
      });
    await openEditAndSave(update);

    await waitFor(visibleConflictNotice);
    expect(update).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Save mine over theirs" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    expect(update).toHaveBeenLastCalledWith({
      planId: "plan-1",
      expectedVersion: 4,
      draft: {
        title: "Supper here",
        details: null,
        plannedFor: null,
        calendarEvent: null,
      },
    });
    expect(screen.getByText("Supper here")).toBeTruthy();
  });

  it("lets the member carry on with their draft against the value they have now seen", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "conflict", message: CONFLICT_MESSAGE, current: beatenBy },
    });
    await openEditAndSave(update);

    await waitFor(visibleConflictNotice);
    await userEvent.click(screen.getByRole("button", { name: "Keep editing mine" }));

    expect(
      screen
        .queryAllByText(CONFLICT_MESSAGE)
        .filter((element) => !element.classList.contains("sr-only")),
    ).toEqual([]);
    const title = screen.getByLabelText("What is it") as HTMLInputElement;
    expect(title.value).toBe("Supper here");
    expect(document.activeElement).toBe(title);

    await userEvent.type(title, " tonight");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedVersion: 4,
        draft: expect.objectContaining({ title: "Supper here tonight" }),
      }),
    );
  });

  /** Giving way is a choice too, and it leaves the current value on the screen. */
  it("lets the member take the other version and drop their own", async () => {
    const update = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "conflict", message: CONFLICT_MESSAGE, current: beatenBy },
    });
    await openEditAndSave(update);

    await waitFor(visibleConflictNotice);
    await userEvent.click(screen.getByRole("button", { name: "Use their version" }));

    expect(screen.queryByLabelText("What is it")).toBeNull();
    expect(screen.getByText("Supper at Ana's")).toBeTruthy();
    expect(screen.getByText("Bring the good plates")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
  });

  /** Archiving refuses to win a race silently too. */
  it("will not put a plan away over a change it did not see", async () => {
    const archive = vi.fn().mockResolvedValue({
      ok: true,
      view: { outcome: "conflict", message: CONFLICT_MESSAGE, current: beatenBy },
    });
    renderShared({ planActions: { archive }, viewerUserId: "ana" });

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.getByText(/Ben changed this plan a moment ago/i)).toBeTruthy();
    });
    expect(screen.queryByRole("heading", { name: "Archived" })).toBeNull();
    expect(screen.getByRole("button", { name: "Archive it anyway" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Leave it as it is" })).toBeTruthy();
  });
});
