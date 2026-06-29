import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmittedOwner, listCalendarSuggestedFollowups } = vi.hoisted(() => ({
  requireAdmittedOwner: vi.fn(),
  listCalendarSuggestedFollowups: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwner }));
vi.mock("@tendnote/db/queries/calendar-followups", () => ({ listCalendarSuggestedFollowups }));

import { getOwnerCalendarPromptNudges } from "./calendar-prompt-nudges";

function suggestion(id: string, reason: string) {
  return {
    id,
    ownerUserId: "owner-1",
    providerEventId: `evt-${id}`,
    calendarId: "primary",
    shape: "post_meeting_followup" as const,
    personId: "p1",
    personDisplayName: "Maya",
    matchKind: "email" as const,
    tentative: false,
    unresolvedAttendee: null,
    reason,
    dueAt: new Date(),
    dedupeKey: id,
    status: "suggested" as const,
    acceptedFollowupId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  requireAdmittedOwner.mockReset();
  listCalendarSuggestedFollowups.mockReset();
});

describe("getOwnerCalendarPromptNudges", () => {
  it("maps the admitted owner's suggestions into calendar-sourced prompt nudges (capped)", async () => {
    requireAdmittedOwner.mockResolvedValue("owner-1");
    listCalendarSuggestedFollowups.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => suggestion(`s${i}`, `Follow up ${i}`)),
    );

    const nudges = await getOwnerCalendarPromptNudges();

    expect(listCalendarSuggestedFollowups).toHaveBeenCalledWith("owner-1");
    expect(nudges).toHaveLength(3); // PROMPT_NUDGE_DISPLAY_CAP
    expect(nudges[0]).toMatchObject({ prompt: "Follow up 0", source: "calendar" });
  });

  it("degrades to no nudges when the read fails", async () => {
    requireAdmittedOwner.mockResolvedValue("owner-1");
    listCalendarSuggestedFollowups.mockRejectedValue(new Error("db down"));

    await expect(getOwnerCalendarPromptNudges()).resolves.toEqual([]);
  });
});
