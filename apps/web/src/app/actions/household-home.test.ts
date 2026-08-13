import { HouseholdRecordUnavailableError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy } from "@/test/action-adapter-mocks";

const {
  completeGeneralAction,
  getHouseholdHome,
  getOwnerTodayContext,
  listShareableHouseholdMembersForUser,
} = vi.hoisted(() => ({
  completeGeneralAction: vi.fn(),
  getHouseholdHome: vi.fn(),
  getOwnerTodayContext: vi.fn(),
  listShareableHouseholdMembersForUser: vi.fn(),
}));

vi.mock("@tendnote/db/queries/general-actions", () => ({
  affectedScopesForOwnerSurfaces: (ownerUserId: string) => [
    { kind: "owner-collection", collection: "today", ownerUserId },
  ],
  completeGeneralAction,
}));
vi.mock("@tendnote/db/queries/household-home", () => ({ getHouseholdHome }));
vi.mock("@tendnote/db/queries/households", () => ({ listShareableHouseholdMembersForUser }));
vi.mock("@tendnote/db/queries/today", () => ({ getOwnerTodayContext }));

import { completeHouseholdHomeRecordAction } from "./household-home";

const CHORE_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-07-21T15:00:00.000Z");

function home() {
  return {
    household: { id: "household-1", name: "Ash Lane" },
    needsAttention: {
      section: "needs_attention",
      heading: "Ready now",
      records: [],
      more: null,
      limitations: [],
    },
    comingUp: {
      section: "coming_up",
      heading: "Coming up",
      records: [],
      more: null,
      limitations: [],
    },
  };
}

function outcome(
  reconciliation: {
    handledAs: "completed" | "skipped";
    handledByUserId: string | null;
    handledAt: Date;
  } | null = null,
) {
  return {
    result: { id: CHORE_ID, reconciliation },
    affectedScopes: [
      { kind: "viewer-collection", collection: "general-actions", viewerUserId: "" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  getOwnerTodayContext.mockResolvedValue({ localDate: "2026-07-21", timeZone: "UTC", now: NOW });
  getHouseholdHome.mockResolvedValue(home());
  completeGeneralAction.mockResolvedValue(outcome());
  listShareableHouseholdMembersForUser.mockResolvedValue([]);
});

describe("completing a record from the Household home", () => {
  it("calls the record's own domain, fenced on the occurrence the member saw", async () => {
    await completeHouseholdHomeRecordAction({
      generalActionId: CHORE_ID,
      expectedOccurrenceVersion: 3,
    });

    expect(completeGeneralAction).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      generalActionId: CHORE_ID,
      expectedOccurrenceVersion: 3,
    });
  });

  it("returns the household's own state rather than patching the member's view", async () => {
    const result = await completeHouseholdHomeRecordAction({
      generalActionId: CHORE_ID,
      expectedOccurrenceVersion: 0,
    });

    expect(result).toMatchObject({ ok: true, view: { household: { name: "Ash Lane" } } });
    expect(getHouseholdHome).toHaveBeenCalledWith({
      callerUserId: "owner-1",
      localDate: "2026-07-21",
      timeZone: "UTC",
      now: NOW,
    });
  });

  it("says who settled the occurrence when this member's tap arrived second", async () => {
    completeGeneralAction.mockResolvedValue(
      outcome({
        handledAs: "completed",
        handledByUserId: "user-member",
        handledAt: new Date("2026-07-20T09:00:00.000Z"),
      }),
    );
    listShareableHouseholdMembersForUser.mockResolvedValue([
      { userId: "user-member", name: "Mara" },
    ]);

    const result = await completeHouseholdHomeRecordAction({
      generalActionId: CHORE_ID,
      expectedOccurrenceVersion: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      view: { reconciliation: "Mara already marked this done Jul 20." },
    });
  });

  it("reports a skip as a skip and never as a completion", async () => {
    completeGeneralAction.mockResolvedValue(
      outcome({
        handledAs: "skipped",
        handledByUserId: null,
        handledAt: new Date("2026-07-20T09:00:00.000Z"),
      }),
    );

    const result = await completeHouseholdHomeRecordAction({
      generalActionId: CHORE_ID,
      expectedOccurrenceVersion: 0,
    });

    expect(result).toMatchObject({ ok: true, view: { reconciliation: /skipped/ } });
    expect(listShareableHouseholdMembersForUser).not.toHaveBeenCalled();
  });

  it("reports nothing extra on an ordinary completion", async () => {
    const result = await completeHouseholdHomeRecordAction({
      generalActionId: CHORE_ID,
      expectedOccurrenceVersion: 0,
    });

    expect(result).toMatchObject({ ok: true, view: { reconciliation: null } });
  });

  /**
   * A member can be looking at a rendered row at the moment their access ends.
   * The tap that follows has to settle the surface quietly, on the domain's one
   * opaque answer, rather than throwing a raw error at a page that is only
   * showing what it was told a moment ago (ADR 0219).
   */
  it("settles quietly when the caller's access ended while the row was on screen", async () => {
    completeGeneralAction.mockRejectedValue(new HouseholdRecordUnavailableError());

    const result = await completeHouseholdHomeRecordAction({
      generalActionId: CHORE_ID,
      expectedOccurrenceVersion: 0,
    });

    expect(result).toEqual({ ok: false, error: "That's no longer available." });
    expect(getHouseholdHome).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not an admitted owner", async () => {
    requireAdmittedOwnerForActionSpy.mockRejectedValue(new Error("Sign in to continue."));

    await expect(
      completeHouseholdHomeRecordAction({
        generalActionId: CHORE_ID,
        expectedOccurrenceVersion: 0,
      }),
    ).rejects.toThrow();
    expect(completeGeneralAction).not.toHaveBeenCalled();
  });
});
