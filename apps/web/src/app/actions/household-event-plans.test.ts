import {
  HouseholdEventPlanConflictError,
  HouseholdRecordUnavailableError,
  HouseholdValidationError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy, updateTagSpy } from "@/test/action-adapter-mocks";

const plans = vi.hoisted(() => ({
  createHouseholdEventPlan: vi.fn(),
  updateHouseholdEventPlan: vi.fn(),
  archiveHouseholdEventPlan: vi.fn(),
  restoreHouseholdEventPlan: vi.fn(),
  linkHouseholdEventPlanRecord: vi.fn(),
  unlinkHouseholdEventPlanRecord: vi.fn(),
  listHouseholdEventPlans: vi.fn(),
}));
vi.mock("@tendnote/db/queries/household-event-plans", () => plans);

vi.mock("@tendnote/db/queries/household-calendar", () => ({
  listHouseholdCalendarConnections: vi.fn(),
  readHouseholdCalendars: vi.fn(),
}));
vi.mock("@tendnote/db/queries/provider-connections", () => ({
  isProviderCapabilityConnected: vi.fn(),
}));
vi.mock("@/lib/auth/social", () => ({
  googleEnvFromProcess: () => ({}),
  isGoogleConfigured: () => true,
}));
// The link picker's three owner-scoped reads are only reachable from the shared
// context read, which these actions never take; they are stubbed so importing
// that module does not drag a database client in.
vi.mock("@tendnote/db/queries/general-actions", () => ({ listActiveGeneralActions: vi.fn() }));
vi.mock("@tendnote/db/queries/followups", () => ({ listActiveFollowups: vi.fn() }));
vi.mock("@tendnote/db/queries/saved-items", () => ({ listSavedItems: vi.fn() }));

import {
  archiveHouseholdEventPlanAction,
  createHouseholdEventPlanAction,
  linkHouseholdEventPlanRecordAction,
  restoreHouseholdEventPlanAction,
  unlinkHouseholdEventPlanRecordAction,
  updateHouseholdEventPlanAction,
} from "./household-event-plans";

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    householdId: "household-1",
    createdByUserId: "owner-1",
    lastActorUserId: "owner-1",
    title: "School night supper",
    details: null,
    plannedFor: null,
    status: "active" as const,
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

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  plans.createHouseholdEventPlan.mockResolvedValue(plan());
  plans.updateHouseholdEventPlan.mockResolvedValue(plan({ version: 2 }));
  plans.archiveHouseholdEventPlan.mockResolvedValue(plan({ status: "archived", version: 2 }));
  plans.restoreHouseholdEventPlan.mockResolvedValue(plan({ version: 3 }));
  plans.linkHouseholdEventPlanRecord.mockResolvedValue({ id: "link-1" });
  plans.unlinkHouseholdEventPlanRecord.mockResolvedValue({ removed: true });
  plans.listHouseholdEventPlans.mockResolvedValue([{ plan: plan(), links: [] }]);
});

/** The refreshed answer: each Plan with the links this reader was proved for. */
const REFRESHED = [{ plan: plan(), links: [] }];

describe("createHouseholdEventPlanAction", () => {
  /**
   * No actor and no household in the payload: the caller comes from the session
   * gate, and their own active membership decides which household this lands in.
   */
  it("creates from the session's caller and answers with the refreshed list", async () => {
    const result = await createHouseholdEventPlanAction({
      draft: {
        title: "School night supper",
        details: "Ask about the recital",
        plannedFor: "2026-08-15",
        calendarEvent: null,
      },
    });

    expect(plans.createHouseholdEventPlan).toHaveBeenCalledWith({
      callerUserId: "owner-1",
      draft: {
        title: "School night supper",
        details: "Ask about the recital",
        plannedFor: new Date("2026-08-15T00:00:00.000Z"),
        calendarEvent: null,
      },
    });
    expect(result).toEqual({ ok: true, view: { outcome: "saved", plans: REFRESHED } });
    expect(updateTagSpy).toHaveBeenCalled();
  });

  /**
   * "Plan this event" contributes an address and nothing else. The title is
   * whatever the member typed, so a Plan is never a copy of the provider event
   * it sits beside.
   */
  it("carries a calendar event's address without any of its content", async () => {
    await createHouseholdEventPlanAction({
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

    expect(plans.createHouseholdEventPlan).toHaveBeenCalledWith({
      callerUserId: "owner-1",
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

  it("refuses a date it cannot read, in words a member can act on", async () => {
    const result = await createHouseholdEventPlanAction({
      draft: { title: "Supper", details: null, plannedFor: "next friday", calendarEvent: null },
    });

    expect(result).toEqual({ ok: false, error: "Use a date like 2026-08-15, or leave it blank." });
    expect(plans.createHouseholdEventPlan).not.toHaveBeenCalled();
  });

  /** The over-length refusal is the domain's sentence, never a parser's. */
  it("renders the domain's own refusal for an untitled plan", async () => {
    plans.createHouseholdEventPlan.mockRejectedValue(
      new HouseholdValidationError("Give this plan a short name so everyone knows what it is."),
    );

    const result = await createHouseholdEventPlanAction({
      draft: { title: "   ", details: null, plannedFor: null, calendarEvent: null },
    });

    expect(result).toEqual({
      ok: false,
      error: "Give this plan a short name so everyone knows what it is.",
    });
  });
});

describe("updateHouseholdEventPlanAction", () => {
  it("writes against the version the member's screen was carrying", async () => {
    await updateHouseholdEventPlanAction({
      planId: "plan-1",
      expectedVersion: 1,
      draft: { title: "Supper", details: null, plannedFor: null, calendarEvent: null },
    });

    expect(plans.updateHouseholdEventPlan).toHaveBeenCalledWith({
      callerUserId: "owner-1",
      planId: "plan-1",
      expectedVersion: 1,
      draft: { title: "Supper", details: null, plannedFor: null, calendarEvent: null },
    });
  });

  /**
   * The most important answer this module gives. A lost fence is data, not a
   * failure: it carries the value that beat the member and who wrote it, so the
   * surface can keep their draft and let them choose. Nothing is written, so
   * nothing is invalidated either.
   */
  it("answers a lost fence with the current value rather than overwriting it", async () => {
    const current = plan({
      title: "Supper at Ana's",
      lastActorUserId: "member-2",
      version: 4,
      updatedAt: new Date("2026-08-09T18:30:00Z"),
    });
    plans.updateHouseholdEventPlan.mockRejectedValue(
      new HouseholdEventPlanConflictError(current as never),
    );

    const result = await updateHouseholdEventPlanAction({
      planId: "plan-1",
      expectedVersion: 1,
      draft: { title: "Supper here", details: null, plannedFor: null, calendarEvent: null },
    });

    expect(result).toEqual({
      ok: true,
      view: {
        outcome: "conflict",
        message: "Someone else changed this plan while you were writing. Your draft is kept below.",
        current,
      },
    });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  /**
   * The proof engine's refusal is one opaque sentence for "not allowed", "never
   * existed", and "you were removed" alike, and it reaches the member as data
   * rather than as an unhandled failure.
   */
  it("renders the opaque authorization refusal in place", async () => {
    plans.updateHouseholdEventPlan.mockRejectedValue(new HouseholdRecordUnavailableError());

    const result = await updateHouseholdEventPlanAction({
      planId: "plan-1",
      expectedVersion: 1,
      draft: { title: "Supper", details: null, plannedFor: null, calendarEvent: null },
    });

    expect(result).toEqual({ ok: false, error: "That's no longer available." });
  });
});

describe("archive and restore", () => {
  it("puts a plan away against its version, and brings it back the same way", async () => {
    await archiveHouseholdEventPlanAction({ planId: "plan-1", expectedVersion: 2 });
    await restoreHouseholdEventPlanAction({ planId: "plan-1", expectedVersion: 3 });

    expect(plans.archiveHouseholdEventPlan).toHaveBeenCalledWith({
      callerUserId: "owner-1",
      planId: "plan-1",
      expectedVersion: 2,
    });
    expect(plans.restoreHouseholdEventPlan).toHaveBeenCalledWith({
      callerUserId: "owner-1",
      planId: "plan-1",
      expectedVersion: 3,
    });
  });

  /** Archive is the removal path, and it too refuses to win a race silently. */
  it("reports a lost fence on archive instead of putting the plan away anyway", async () => {
    const current = plan({ version: 5, lastActorUserId: "member-2" });
    plans.archiveHouseholdEventPlan.mockRejectedValue(
      new HouseholdEventPlanConflictError(current as never),
    );

    const result = await archiveHouseholdEventPlanAction({ planId: "plan-1", expectedVersion: 2 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.view.outcome).toBe("conflict");
    expect(updateTagSpy).not.toHaveBeenCalled();
  });
});

/**
 * A link points a Plan at a record and does nothing else. No version travels
 * with it, because a link neither reads nor replaces the Plan's own value: two
 * members linking at the same moment make two links, not a conflict.
 */
describe("linking and unlinking records", () => {
  it("links from the session's caller and answers with the refreshed list", async () => {
    const result = await linkHouseholdEventPlanRecordAction({
      planId: "plan-1",
      linkKind: "general_action",
      recordId: "action-1",
    });

    expect(plans.linkHouseholdEventPlanRecord).toHaveBeenCalledWith({
      callerUserId: "owner-1",
      planId: "plan-1",
      linkKind: "general_action",
      recordId: "action-1",
    });
    expect(result).toEqual({ ok: true, view: { outcome: "saved", plans: REFRESHED } });
    expect(updateTagSpy).toHaveBeenCalled();
  });

  it("unlinks against the link, never against the record it pointed at", async () => {
    const result = await unlinkHouseholdEventPlanRecordAction({
      planId: "plan-1",
      linkId: "link-1",
    });

    expect(plans.unlinkHouseholdEventPlanRecord).toHaveBeenCalledWith({
      callerUserId: "owner-1",
      planId: "plan-1",
      linkId: "link-1",
    });
    expect(result).toEqual({ ok: true, view: { outcome: "saved", plans: REFRESHED } });
  });

  /** The three families the proof engine can describe, and nothing else. */
  it("refuses a record family a plan cannot link", async () => {
    const result = await linkHouseholdEventPlanRecordAction({
      planId: "plan-1",
      linkKind: "person" as never,
      recordId: "person-1",
    });

    expect(result.ok).toBe(false);
    expect(plans.linkHouseholdEventPlanRecord).not.toHaveBeenCalled();
  });

  /**
   * One opaque sentence covers "not allowed", "never existed", and "you were
   * removed" alike, and it reaches the member as data rather than as an
   * unhandled failure (ADR 0219).
   */
  it("renders the opaque authorization refusal in place", async () => {
    plans.linkHouseholdEventPlanRecord.mockRejectedValue(new HouseholdRecordUnavailableError());

    const result = await linkHouseholdEventPlanRecordAction({
      planId: "plan-1",
      linkKind: "saved_item",
      recordId: "saved-1",
    });

    expect(result).toEqual({ ok: false, error: "That's no longer available." });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  /** An archived Plan is closed to links, in the domain's own words. */
  it("passes the lifecycle refusal through as the sentence the domain wrote", async () => {
    plans.unlinkHouseholdEventPlanRecord.mockRejectedValue(
      new HouseholdValidationError(
        "This plan is archived. Bring it back first if you want to change it.",
      ),
    );

    const result = await unlinkHouseholdEventPlanRecordAction({
      planId: "plan-1",
      linkId: "link-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "This plan is archived. Bring it back first if you want to change it.",
    });
  });
});
