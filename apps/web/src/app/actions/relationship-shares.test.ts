import {
  HouseholdRecordUnavailableError,
  RelationshipShareValidationError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy, updateTagSpy } from "@/test/action-adapter-mocks";

const db = vi.hoisted(() => ({ shareRelationshipRecord: vi.fn() }));

vi.mock("@tendnote/db/queries/relationship-shares", () => db);

import { setRelationshipShareAudienceAction } from "./relationship-shares";

const RECORD_ID = "11111111-1111-4111-8111-111111111111";

const STATE = {
  recordKind: "memory" as const,
  recordId: RECORD_ID,
  scope: "shared" as const,
  visibilityChoice: "selected_members" as const,
  selectedUserIds: ["member-2"],
  sensitivity: "normal" as const,
  householdName: "Rivera House",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  db.shareRelationshipRecord.mockResolvedValue(STATE);
});

describe("setRelationshipShareAudienceAction", () => {
  /**
   * The owner comes from the session, never the payload. An action that took an
   * owner id would let any caller re-address anybody's record.
   */
  it("takes the owner from the session and the record from the request", async () => {
    const result = await setRelationshipShareAudienceAction({
      recordKind: "memory",
      recordId: RECORD_ID,
      visibilityChoice: "selected_members",
      selectedUserIds: ["member-2"],
    });

    expect(result).toEqual({ ok: true, view: STATE });
    expect(db.shareRelationshipRecord).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      recordKind: "memory",
      recordId: RECORD_ID,
      visibilityChoice: "selected_members",
      selectedUserIds: ["member-2"],
      confirmedRestricted: undefined,
    });
  });

  it("refuses a record family that cannot carry a Relationship Share", async () => {
    const result = await setRelationshipShareAudienceAction({
      recordKind: "general_action",
      recordId: RECORD_ID,
      visibilityChoice: "whole_household",
    });

    expect(result.ok).toBe(false);
    expect(db.shareRelationshipRecord).not.toHaveBeenCalled();
  });

  it("refuses an unexpected field rather than ignoring it", async () => {
    const result = await setRelationshipShareAudienceAction({
      recordKind: "memory",
      recordId: RECORD_ID,
      visibilityChoice: "whole_household",
      ownerUserId: "someone-else",
    });

    expect(result.ok).toBe(false);
    expect(db.shareRelationshipRecord).not.toHaveBeenCalled();
  });

  it("carries the owner's restricted confirmation through", async () => {
    await setRelationshipShareAudienceAction({
      recordKind: "memory",
      recordId: RECORD_ID,
      visibilityChoice: "whole_household",
      confirmedRestricted: true,
    });

    expect(db.shareRelationshipRecord).toHaveBeenCalledWith(
      expect.objectContaining({ confirmedRestricted: true }),
    );
  });

  it("returns a share refusal as data the surface can render", async () => {
    db.shareRelationshipRecord.mockRejectedValue(
      new RelationshipShareValidationError(
        "Confirm the audience before sharing this restricted memory.",
      ),
    );

    const result = await setRelationshipShareAudienceAction({
      recordKind: "memory",
      recordId: RECORD_ID,
      visibilityChoice: "whole_household",
    });

    expect(result).toEqual({
      ok: false,
      error: "Confirm the audience before sharing this restricted memory.",
    });
  });

  /**
   * An authorization denial reaches the owner as the one opaque sentence — not
   * as a crash, and not as anything that names what was refused.
   */
  it("returns the opaque refusal without naming the record", async () => {
    db.shareRelationshipRecord.mockRejectedValue(new HouseholdRecordUnavailableError());

    const result = await setRelationshipShareAudienceAction({
      recordKind: "memory",
      recordId: RECORD_ID,
      visibilityChoice: "whole_household",
    });

    expect(result).toEqual({ ok: false, error: "That's no longer available." });
    expect(JSON.stringify(result)).not.toContain(RECORD_ID);
  });

  it("refreshes the owner's own surfaces after an audience change", async () => {
    await setRelationshipShareAudienceAction({
      recordKind: "memory",
      recordId: RECORD_ID,
      visibilityChoice: "whole_household",
    });

    const tags = updateTagSpy.mock.calls.map(([tag]) => tag);
    expect(tags).toContain("people:owner:owner-1");
    expect(tags).toContain("today:owner:owner-1");
  });
});
