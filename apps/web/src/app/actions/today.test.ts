import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  completeFollowup,
  completeGeneralAction,
  getOwnerTodayContext,
  getTodayCandidate,
  getTodayShortlist,
  reconcileAffectedScopes,
  requireAdmittedOwnerForAction,
  revalidatePath,
  suppressTodayCandidate,
  updateTag,
} = vi.hoisted(() => ({
  completeFollowup: vi.fn(),
  completeGeneralAction: vi.fn(),
  getOwnerTodayContext: vi.fn(),
  getTodayCandidate: vi.fn(),
  getTodayShortlist: vi.fn(),
  reconcileAffectedScopes: vi.fn(),
  requireAdmittedOwnerForAction: vi.fn(),
  revalidatePath: vi.fn(),
  suppressTodayCandidate: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@tendnote/db/queries/followups", () => ({ completeFollowup }));
vi.mock("@tendnote/db/queries/general-actions", () => ({ completeGeneralAction }));
vi.mock("@tendnote/db/queries/today", () => ({
  getOwnerTodayContext,
  getTodayCandidate,
  getTodayShortlist,
  suppressTodayCandidate,
}));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwnerForAction }));
vi.mock("@/lib/cache/reconcile-affected-scopes", () => ({ reconcileAffectedScopes }));
vi.mock("next/cache", () => ({ revalidatePath, updateTag }));

import { actOnTodayItemAction, suppressTodayItemAction } from "./today";

const FOLLOWUP_ID = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-07-21T15:00:00.000Z");

function shortlist() {
  return {
    items: [
      {
        identity: `follow_up:${FOLLOWUP_ID}`,
        family: "follow_up",
        record: { kind: "follow_up", id: FOLLOWUP_ID, href: "/people/person-1" },
        title: "Call Sam",
        context: "Sam",
        reason: { code: "due_today", key: "due:today", explanation: "Due today." },
        sourceRefs: [{ kind: "followup", id: FOLLOWUP_ID }],
        action: { kind: "complete_follow_up", label: "Complete" },
        mandatory: true,
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

describe("Today web actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmittedOwnerForAction.mockResolvedValue("owner-1");
    getOwnerTodayContext.mockResolvedValue({
      localDate: "2026-07-21",
      timeZone: "America/Chicago",
      now: NOW,
    });
    getTodayShortlist.mockResolvedValue(shortlist());
    getTodayCandidate.mockResolvedValue(shortlist().items[0]);
    suppressTodayCandidate.mockResolvedValue({});
    completeFollowup.mockResolvedValue({});
    completeGeneralAction.mockResolvedValue({
      result: {},
      affectedScopes: [{ kind: "owner-collection", collection: "today", ownerUserId: "owner-1" }],
    });
  });

  it("derives owner scope for Today-only suppression", async () => {
    await suppressTodayItemAction({
      localDate: "2026-07-21",
      candidateIdentity: `follow_up:${FOLLOWUP_ID}`,
      reasonKey: "due:today",
      kind: "not_today",
      suppressUntil: null,
    });

    expect(suppressTodayCandidate).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      timeZone: "America/Chicago",
      now: NOW,
      candidateIdentity: `follow_up:${FOLLOWUP_ID}`,
      reasonKey: "due:today",
      kind: "not_today",
      suppressUntil: null,
    });
    expect(updateTag).toHaveBeenCalledWith("today:owner:owner-1");
    expect(updateTag).toHaveBeenCalledWith("review:owner:owner-1");
  });

  it("reloads the authoritative candidate before using its real domain action", async () => {
    await actOnTodayItemAction({
      localDate: "2026-07-21",
      candidateIdentity: `follow_up:${FOLLOWUP_ID}`,
      reasonKey: "due:today",
    });

    expect(getTodayCandidate).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      timeZone: "America/Chicago",
      now: NOW,
      candidateIdentity: `follow_up:${FOLLOWUP_ID}`,
      reasonKey: "due:today",
    });
    expect(completeFollowup).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      followupId: FOLLOWUP_ID,
    });
    expect(updateTag).toHaveBeenCalledWith("today:owner:owner-1");
  });

  it("expires the Action projections when Today completes an Action", async () => {
    const actionId = "22222222-2222-2222-2222-222222222222";
    getTodayCandidate.mockResolvedValue({
      ...shortlist().items[0],
      identity: `general_action:${actionId}`,
      record: { kind: "general_action", id: actionId, href: "/actions" },
      action: { kind: "complete_action", label: "Complete" },
    });

    await actOnTodayItemAction({
      localDate: "2026-07-21",
      candidateIdentity: `general_action:${actionId}`,
      reasonKey: "due:today",
    });

    expect(completeGeneralAction).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      generalActionId: actionId,
    });
    expect(reconcileAffectedScopes).toHaveBeenCalledWith(
      [{ kind: "owner-collection", collection: "today", ownerUserId: "owner-1" }],
      { origin: "owner-action" },
    );
  });
});
