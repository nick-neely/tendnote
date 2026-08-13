// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/**
 * jsdom implements no layout, so it ships no `ResizeObserver` — which Radix's
 * radio indicator measures itself with on mount. Stubbed here rather than in the
 * shared harness: nothing in this file asserts a size, and a no-op keeps the gap
 * visible to whichever file needs it next.
 */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const actions = vi.hoisted(() => ({
  createGiftPlanAction: vi.fn(),
  addGiftIdeaAction: vi.fn(),
  claimGiftIdeaAction: vi.fn(),
  editGiftIdeaAction: vi.fn(),
  editGiftPlanAction: vi.fn(),
  releaseGiftIdeaAction: vi.fn(),
  removeGiftIdeaAction: vi.fn(),
  setGiftPlanAudienceAction: vi.fn(),
  setGiftPlanStatusAction: vi.fn(),
  setGiftPlanSurpriseSubjectAction: vi.fn(),
}));
vi.mock("@/app/actions/gift-plans", () => actions);

import type { GiftIdeaView, GiftPlanDetailView, GiftPlanView } from "@/lib/gift-plan-view";
import { GiftPlanDetailSurface } from "./gift-plan-detail-surface";
import { GiftPlanSurpriseNote } from "./gift-plan-shared";
import { GiftPlansSurface } from "./gift-plans-surface";

function plan(overrides: Partial<GiftPlanView> = {}): GiftPlanView {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    revision: 0,
    subjectName: "Rowan",
    occasion: "Fortieth birthday",
    occasionOn: null,
    timingLabel: "In 3 weeks",
    status: "active",
    statusLabel: null,
    acceptsCommitments: true,
    closedReason: null,
    scope: "shared",
    visibilityLabel: "Shared with 1 person",
    householdName: "The Neely house",
    subjectPersonId: null,
    surprise: false,
    owned: true,
    coPlannerCount: 1,
    ideaCount: 0,
    claimedIdeaCount: 0,
    ...overrides,
  };
}

function idea(overrides: Partial<GiftIdeaView> = {}): GiftIdeaView {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    revision: 0,
    title: "Wool blanket",
    note: null,
    url: null,
    contributorLabel: "Mara",
    mine: false,
    claimedByLabel: null,
    claimedByMe: false,
    ...overrides,
  };
}

function detail(overrides: Partial<GiftPlanDetailView> = {}): GiftPlanDetailView {
  return {
    plan: plan(),
    ideas: [],
    history: [],
    ...overrides,
  };
}

const CELEBRATED = {
  status: "celebrated",
  statusLabel: "Celebrated",
  acceptsCommitments: false,
  closedReason: "This plan is marked celebrated. Reopen it to add or claim ideas.",
} as const;

const MEMBERS = [
  { userId: "user-mara", name: "Mara", email: "mara@example.com" },
  { userId: "user-sam", name: "Sam", email: "sam@example.com" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the gift plan list", () => {
  it("teaches the next step without guilt when there is nothing yet", () => {
    render(<GiftPlansSurface plans={[]} />);
    expect(screen.getByText("No gift plans yet")).toBeTruthy();
    expect(screen.getByText(/Plans stay private until you choose someone/)).toBeTruthy();
  });

  it("leads with the person, then the occasion", () => {
    render(<GiftPlansSurface plans={[plan()]} />);
    expect(screen.getByText("Rowan")).toBeTruthy();
    expect(screen.getByText("Fortieth birthday")).toBeTruthy();
    expect(screen.getByText("Shared with 1 person")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Rowan/ }).getAttribute("href")).toBe(
      "/gift-plans/11111111-1111-4111-8111-111111111111",
    );
  });

  it("shows Only me on a private plan, because who is included is the fact the row is for", () => {
    render(
      <GiftPlansSurface
        plans={[plan({ scope: "private", coPlannerCount: 0, visibilityLabel: "Only me" })]}
      />,
    );
    expect(screen.getByText("Only me")).toBeTruthy();
  });

  it("marks a protected plan with a word, not only a colour", () => {
    render(<GiftPlansSurface plans={[plan({ surprise: true })]} />);
    expect(screen.getByText("Surprise")).toBeTruthy();
  });

  it("says nothing about surprises on an unprotected plan", () => {
    render(<GiftPlansSurface plans={[plan()]} />);
    expect(screen.queryByText("Surprise")).toBeNull();
  });
});

describe("starting a plan", () => {
  it("offers surprise protection only once an audience is chosen", async () => {
    const user = userEvent.setup();
    render(<GiftPlansSurface plans={[]} shareableMembers={MEMBERS} />);
    await user.click(screen.getByRole("button", { name: /Start a plan/ }));

    expect(screen.queryByLabelText(/Is this a surprise/)).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Specific people/ }));
    expect(screen.getByLabelText(/Is this a surprise/)).toBeTruthy();
  });

  it("holds the protection note back until someone is actually chosen", async () => {
    const user = userEvent.setup();
    render(<GiftPlansSurface plans={[]} shareableMembers={MEMBERS} />);
    await user.click(screen.getByRole("button", { name: /Start a plan/ }));
    await user.click(screen.getByRole("radio", { name: /Specific people/ }));

    // The control is offered; the promise is not made until it is answered.
    expect(screen.getByLabelText(/Is this a surprise/)).toBeTruthy();
    expect(screen.queryByText(/won't see this plan/)).toBeNull();
  });

  it("renders the seam's refusal inline rather than throwing", async () => {
    const user = userEvent.setup();
    actions.createGiftPlanAction.mockResolvedValue({
      ok: false,
      error: "You can't add the person this is a surprise for as a co-planner.",
    });
    render(<GiftPlansSurface plans={[]} shareableMembers={MEMBERS} />);
    await user.click(screen.getByRole("button", { name: /Start a plan/ }));
    await user.type(screen.getByLabelText("Who is it for?"), "Rowan");
    await user.type(screen.getByLabelText("What's the occasion?"), "Birthday");
    await user.click(screen.getByRole("button", { name: "Start plan" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("surprise for as a co-planner");
    });
  });
});

describe("the surprise promise", () => {
  it("names the surfaces it covers rather than reassuring in the abstract", () => {
    render(<GiftPlanSurpriseNote name="Mara" />);
    const note = screen.getByText(/Mara won't see this plan/);
    expect(note.textContent).toContain("its ideas, or any mention of it");
    expect(note.textContent).toContain(
      "not in lists, search, reminders, or a link someone sends them",
    );
  });

  it("stays plain when the person has no name to use", () => {
    render(<GiftPlanSurpriseNote name={null} />);
    expect(screen.getByText(/They won't see this plan/)).toBeTruthy();
  });
});

describe("the gift plan detail", () => {
  it("names who can see the plan with the shared visibility chip", () => {
    render(<GiftPlanDetailSurface detail={detail()} />);
    expect(screen.getByText("Shared with 1 person")).toBeTruthy();
  });

  it("offers the claim to anyone who can see an unclaimed idea", async () => {
    const user = userEvent.setup();
    actions.claimGiftIdeaAction.mockResolvedValue({
      ok: true,
      view: idea({ claimedByLabel: "You", claimedByMe: true }),
    });
    render(<GiftPlanDetailSurface detail={detail({ ideas: [idea()] })} />);

    await user.click(screen.getByRole("button", { name: /I'll handle this/ }));
    await waitFor(() => {
      expect(screen.getByText(/You're handling this/)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Let it go/ })).toBeTruthy();
  });

  it("shows who has an idea without offering to take it from them", () => {
    render(<GiftPlanDetailSurface detail={detail({ ideas: [idea({ claimedByLabel: "Sam" })] })} />);
    expect(screen.getByText(/Sam is handling this/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /I'll handle this/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Let it go/ })).toBeNull();
  });

  it("offers removal to the contributor and to nobody else", () => {
    const { unmount } = render(
      <GiftPlanDetailSurface detail={detail({ ideas: [idea({ mine: false })] })} />,
    );
    expect(screen.queryByRole("button", { name: /Remove Wool blanket/ })).toBeNull();
    unmount();

    render(
      <GiftPlanDetailSurface
        detail={detail({ ideas: [idea({ mine: true, contributorLabel: "You" })] })}
      />,
    );
    expect(screen.getByRole("button", { name: /Remove Wool blanket/ })).toBeTruthy();
  });

  it("keeps plan settings out of a co-planner's hands", () => {
    render(
      <GiftPlanDetailSurface
        detail={detail({ plan: plan({ owned: false }) })}
        shareableMembers={MEMBERS}
      />,
    );
    expect(screen.queryByText("Plan settings")).toBeNull();
  });

  it("gives the owner the settings, and the plan's own protection note", () => {
    render(
      <GiftPlanDetailSurface
        detail={detail({ plan: plan({ surprise: true }) })}
        shareableMembers={MEMBERS}
      />,
    );
    expect(screen.getByText("Plan settings")).toBeTruthy();
    expect(screen.getByText("Surprise")).toBeTruthy();
    expect(screen.getByText(/They won't see this plan/)).toBeTruthy();
  });

  it("tells the story of the plan in sentences, never event names or ids", () => {
    render(
      <GiftPlanDetailSurface
        detail={detail({
          history: [
            { id: "e1", at: "2026-08-01T10:00:00Z", summary: "Mara added an idea" },
            { id: "e2", at: "2026-08-02T10:00:00Z", summary: "You started this plan" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Mara added an idea")).toBeTruthy();
    expect(screen.getByText("You started this plan")).toBeTruthy();
    expect(screen.queryByText(/idea_added/)).toBeNull();
  });
});

describe("a plan that is no longer taking commitments", () => {
  it("says so in the header, to every viewer and not only the owner", () => {
    render(
      <GiftPlanDetailSurface detail={detail({ plan: plan({ ...CELEBRATED, owned: false }) })} />,
    );
    expect(screen.getByText("Celebrated")).toBeTruthy();
  });

  it("carries the same word on the list row", () => {
    render(<GiftPlansSurface plans={[plan({ ...CELEBRATED })]} />);
    expect(screen.getByText("Celebrated")).toBeTruthy();
  });

  it("replaces the add control with the reason and the way back", () => {
    render(<GiftPlanDetailSurface detail={detail({ plan: plan({ ...CELEBRATED }) })} />);
    expect(screen.queryByRole("button", { name: /Add an idea/ })).toBeNull();
    expect(screen.getByText(/marked celebrated\. Reopen it to add or claim ideas/)).toBeTruthy();
  });

  it("stops a co-planner claiming a gift for a party that already happened", () => {
    render(
      <GiftPlanDetailSurface detail={detail({ plan: plan({ ...CELEBRATED }), ideas: [idea()] })} />,
    );
    expect(screen.queryByRole("button", { name: /I'll handle this/ })).toBeNull();
  });

  it("still lets the holder of a claim let it go", () => {
    render(
      <GiftPlanDetailSurface
        detail={detail({
          plan: plan({ ...CELEBRATED }),
          ideas: [idea({ claimedByLabel: "You", claimedByMe: true })],
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Let it go/ })).toBeTruthy();
  });
});

describe("losing a claim race", () => {
  it("corrects the row in place and says who has it, beside the idea", async () => {
    const user = userEvent.setup();
    actions.claimGiftIdeaAction.mockResolvedValue({
      ok: false,
      error: "Someone else already said they'd handle this one.",
      conflict: {
        currentValue: "Wool blanket",
        actorUserId: "user-sam",
        actorName: "Sam",
        revision: 2,
      },
    });
    render(<GiftPlanDetailSurface detail={detail({ ideas: [idea()] })} />);

    await user.click(screen.getByRole("button", { name: /I'll handle this/ }));

    await waitFor(() => {
      expect(screen.getByText(/Sam is handling this/)).toBeTruthy();
    });
    // The stale control is gone, so there is nothing left to press again.
    expect(screen.queryByRole("button", { name: /I'll handle this/ })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("already said they'd handle");
  });

  it("announces a claim that did land, politely", async () => {
    const user = userEvent.setup();
    actions.claimGiftIdeaAction.mockResolvedValue({
      ok: true,
      view: idea({ claimedByLabel: "You", claimedByMe: true }),
    });
    render(<GiftPlanDetailSurface detail={detail({ ideas: [idea()] })} />);

    await user.click(screen.getByRole("button", { name: /I'll handle this/ }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("You're handling Wool blanket.");
    });
  });

  it("moves focus onto the control that replaced the one it pressed", async () => {
    const user = userEvent.setup();
    actions.claimGiftIdeaAction.mockResolvedValue({
      ok: true,
      view: idea({ claimedByLabel: "You", claimedByMe: true }),
    });
    render(<GiftPlanDetailSurface detail={detail({ ideas: [idea()] })} />);

    await user.click(screen.getByRole("button", { name: /I'll handle this/ }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /Let it go/ }));
    });
  });
});

describe("correcting what is already written", () => {
  it("lets the owner fix the subject without recreating the plan", async () => {
    const user = userEvent.setup();
    actions.editGiftPlanAction.mockResolvedValue({
      ok: true,
      view: plan({ subjectName: "Riley" }),
    });
    render(
      <GiftPlanDetailSurface
        detail={detail({ plan: plan({ subjectPersonId: null }) })}
        shareableMembers={MEMBERS}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Edit details/ }));
    const field = screen.getByLabelText("Who is it for?");
    await user.clear(field);
    await user.type(field, "Riley");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => {
      expect(actions.editGiftPlanAction).toHaveBeenCalledWith(
        expect.objectContaining({ subjectName: "Riley", expectedRevision: 0 }),
      );
    });
  });

  it("offers an explicit replace when the record moved underneath the draft", async () => {
    const user = userEvent.setup();
    actions.editGiftIdeaAction.mockResolvedValue({
      ok: false,
      error: "This idea changed while you were editing.",
      conflict: {
        currentValue: "Wool blanket, grey",
        actorUserId: "user-sam",
        actorName: "Sam",
        revision: 3,
      },
    });
    render(
      <GiftPlanDetailSurface
        detail={detail({ ideas: [idea({ mine: true, contributorLabel: "You" })] })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save idea" }));

    await waitFor(() => {
      expect(screen.getByText(/Sam changed this to/)).toBeTruthy();
    });
    // The draft survives the conflict, and the form stays open to hold it.
    expect(screen.getByLabelText("Idea")).toBeTruthy();

    actions.editGiftIdeaAction.mockResolvedValue({ ok: true, view: idea({ mine: true }) });
    await user.click(screen.getByRole("button", { name: "Save idea" }));
    await waitFor(() => {
      // The second submit is the deliberate replace: no revision to lose against.
      expect(actions.editGiftIdeaAction).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ expectedRevision: expect.anything() }),
      );
    });
  });

  it("offers editing only to the contributor", () => {
    const { unmount } = render(
      <GiftPlanDetailSurface detail={detail({ ideas: [idea({ mine: false })] })} />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    unmount();

    render(
      <GiftPlanDetailSurface
        detail={detail({ ideas: [idea({ mine: true, contributorLabel: "You" })] })}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
});

describe("focus after a form closes", () => {
  it("returns to the control that opened it", async () => {
    const user = userEvent.setup();
    actions.addGiftIdeaAction.mockResolvedValue({ ok: true, view: idea() });
    render(<GiftPlanDetailSurface detail={detail()} />);

    const trigger = screen.getByRole("button", { name: /Add an idea/ });
    await user.click(trigger);
    await user.type(screen.getByLabelText("Idea"), "Wool blanket");
    await user.click(screen.getByRole("button", { name: "Add idea" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /Add an idea/ }));
    });
  });

  it("returns there on cancel too", async () => {
    const user = userEvent.setup();
    render(<GiftPlanDetailSurface detail={detail()} />);

    await user.click(screen.getByRole("button", { name: /Add an idea/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Add an idea/ }));
  });
});

describe("the way back to the person", () => {
  it("links the subject for the owner who kept them", () => {
    render(
      <GiftPlanDetailSurface
        detail={detail({ plan: plan({ subjectPersonId: "person-1", owned: true }) })}
      />,
    );
    expect(screen.getByRole("link", { name: "Rowan" }).getAttribute("href")).toBe(
      "/people/person-1",
    );
  });

  it("does not offer a co-planner a person they may not be allowed to open", () => {
    render(
      <GiftPlanDetailSurface
        detail={detail({ plan: plan({ subjectPersonId: "person-1", owned: false }) })}
      />,
    );
    expect(screen.queryByRole("link", { name: "Rowan" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Rowan" })).toBeTruthy();
  });
});
