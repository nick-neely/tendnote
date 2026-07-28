import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy } from "@/test/action-adapter-mocks";

const { searchPeople, listActiveFollowups, getCalendarPromptNudgesForOwner } = vi.hoisted(() => ({
  searchPeople: vi.fn(),
  listActiveFollowups: vi.fn(),
  getCalendarPromptNudgesForOwner: vi.fn(),
}));

vi.mock("@tendnote/db/queries/people", () => ({ searchPeople }));
vi.mock("@tendnote/db/queries/followups", () => ({ listActiveFollowups }));
vi.mock("@/lib/integrations/calendar-prompt-nudges", () => ({ getCalendarPromptNudgesForOwner }));

import { loadMobileEveContextAction } from "./eve-context";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  searchPeople.mockResolvedValue([{ displayName: "Ada" }]);
  listActiveFollowups.mockResolvedValue([{ person: { displayName: "Grace" } }]);
  getCalendarPromptNudgesForOwner.mockResolvedValue([{ text: "Prepare for your next meeting." }]);
});

describe("loadMobileEveContextAction", () => {
  it("re-resolves the owner and loads the bounded Eve context only for that owner", async () => {
    await expect(loadMobileEveContextAction()).resolves.toEqual({
      ok: true,
      view: {
        nudges: [{ text: "Prepare for your next meeting." }],
        suggestPersonName: "Grace",
      },
    });

    expect(searchPeople).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 8 });
    expect(listActiveFollowups).toHaveBeenCalledWith({ ownerUserId: "owner-1", limit: 5 });
    expect(getCalendarPromptNudgesForOwner).toHaveBeenCalledWith("owner-1");
  });

  it("does not start an Eve read when the admitted action gate rejects the caller", async () => {
    requireAdmittedOwnerForActionSpy.mockRejectedValue(new Error("not admitted"));

    await expect(loadMobileEveContextAction()).rejects.toThrow("not admitted");
    expect(searchPeople).not.toHaveBeenCalled();
    expect(listActiveFollowups).not.toHaveBeenCalled();
    expect(getCalendarPromptNudgesForOwner).not.toHaveBeenCalled();
  });
});
