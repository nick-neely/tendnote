import {
  HouseholdRecordUnavailableError,
  RelationshipShareValidationError,
} from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryRelationshipShareStore } from "./in-memory-store";
import { createRelationshipSharing } from "./sharing";
import type { RelationshipRecordFacts } from "./types";

const OWNER = "owner-1";
const MEMBER = "member-1";
const OTHER_MEMBER = "member-2";
const OUTSIDER = "outsider-1";

const RECORDED_AT = new Date("2026-05-01T00:00:00Z");

function memory(overrides: Partial<RelationshipRecordFacts> = {}): RelationshipRecordFacts {
  return {
    recordKind: "memory",
    recordId: "memory-1",
    ownerUserId: OWNER,
    personId: "person-1",
    scope: "private",
    householdId: null,
    sensitivity: "normal",
    lifecycle: "active",
    shareable: true,
    body: "Prefers tea over coffee.",
    recordedAt: RECORDED_AT,
    trust: "high",
    dueAt: null,
    ...overrides,
  };
}

function sourceRecord(overrides: Partial<RelationshipRecordFacts> = {}): RelationshipRecordFacts {
  return memory({
    recordKind: "source_record",
    recordId: "source-1",
    body: "Coffee on Tuesday, mentioned the new job.",
    trust: "medium",
    ...overrides,
  });
}

function followup(overrides: Partial<RelationshipRecordFacts> = {}): RelationshipRecordFacts {
  return memory({
    recordKind: "followup",
    recordId: "followup-1",
    body: "Ask how the first week went.",
    trust: null,
    dueAt: new Date("2026-06-10T00:00:00Z"),
    ...overrides,
  });
}

async function setup(records: RelationshipRecordFacts[] = [memory()]) {
  const store = createInMemoryRelationshipShareStore({
    records,
    personLabels: { [`${OWNER}:person-1`]: "Ada" },
    memberNames: { [OWNER]: "Mara", [MEMBER]: "Jon", [OTHER_MEMBER]: "Sam" },
  });
  const household = await seedHouseholdWithMembers(store, {
    ownerUserId: OWNER,
    name: "Rivera House",
    members: [
      [OWNER, "owner"],
      [MEMBER, "member"],
      [OTHER_MEMBER, "member"],
    ],
  });
  return { store, household, sharing: createRelationshipSharing(store) };
}

describe("choosing an audience", () => {
  it("shares a memory with selected members and records who was chosen", async () => {
    const { sharing } = await setup();

    const state = await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "selected_members",
      selectedUserIds: [MEMBER],
    });

    expect(state.scope).toBe("shared");
    expect(state.selectedUserIds).toEqual([MEMBER]);
    expect(state.householdName).toBe("Rivera House");
  });

  it("shares with the whole household without writing per-member rows", async () => {
    const { sharing, store, household } = await setup();

    const state = await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "whole_household",
    });

    expect(state.scope).toBe("household");
    expect(
      await store.listHouseholdRecordShares({
        householdId: household.id,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toEqual([]);
  });

  it("does not treat the owner as their own audience", async () => {
    const { sharing } = await setup();

    await expect(
      sharing.shareRelationshipRecord({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: "memory-1",
        visibilityChoice: "selected_members",
        selectedUserIds: [OWNER],
      }),
    ).rejects.toThrow(RelationshipShareValidationError);
  });

  it("refuses an audience member who is not an active member", async () => {
    const { sharing } = await setup();

    await expect(
      sharing.shareRelationshipRecord({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: "memory-1",
        visibilityChoice: "selected_members",
        selectedUserIds: [OUTSIDER],
      }),
    ).rejects.toThrow(RelationshipShareValidationError);
  });

  it("refuses to share a suggestion the owner has not reviewed", async () => {
    const { sharing } = await setup([memory({ shareable: false })]);

    await expect(
      sharing.shareRelationshipRecord({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: "memory-1",
        visibilityChoice: "whole_household",
      }),
    ).rejects.toThrow(/Review this memory/);
  });

  it("audits the audience decision", async () => {
    const { sharing, store } = await setup();

    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "selected_members",
      selectedUserIds: [MEMBER],
    });

    const entries = await store.listAuditLogEntries({ ownerUserId: OWNER });
    expect(entries.at(-1)).toMatchObject({
      action: "relationship_record.set_audience",
      entityType: "memory",
      entityId: "memory-1",
      metadataJson: { previousScope: "private", scope: "shared", selectedUserIds: [MEMBER] },
    });
  });
});

describe("a share confers reading and nothing else", () => {
  it("lets an audience member read the record", async () => {
    const { sharing } = await setup();
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "selected_members",
      selectedUserIds: [MEMBER],
    });

    const view = await sharing.readSharedRelationshipRecord({
      callerUserId: MEMBER,
      recordKind: "memory",
      recordId: "memory-1",
    });
    expect(view?.body).toBe("Prefers tea over coffee.");
    expect(view?.sharedByName).toBe("Mara");
    expect(view?.viewerIsOwner).toBe(false);
  });

  it("does not let an audience member re-address the record", async () => {
    const { sharing, store } = await setup();
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "selected_members",
      selectedUserIds: [MEMBER],
    });

    await expect(
      sharing.shareRelationshipRecord({
        ownerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
        visibilityChoice: "whole_household",
      }),
    ).rejects.toThrow(HouseholdRecordUnavailableError);

    expect(store.readSeededRecord("memory-1")?.scope).toBe("shared");
  });

  it("does not let an audience member inspect who else can see it", async () => {
    const { sharing } = await setup();
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "selected_members",
      selectedUserIds: [MEMBER, OTHER_MEMBER],
    });

    await expect(
      sharing.getRelationshipShareState({
        ownerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).rejects.toThrow(HouseholdRecordUnavailableError);

    expect(
      await sharing.listRelationshipShareAudiences({
        ownerUserId: MEMBER,
        recordKind: "memory",
        recordIds: ["memory-1"],
      }),
    ).toEqual({});
  });
});

describe("what a recipient can and cannot see", () => {
  async function sharedMemoryView() {
    const { sharing, household } = await setup([memory(), sourceRecord()]);
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "whole_household",
    });
    const view = await sharing.readSharedRelationshipRecord({
      callerUserId: MEMBER,
      recordKind: "memory",
      recordId: "memory-1",
    });
    return { view, householdId: household.id };
  }

  it("carries the owner's deliberately exposed person label", async () => {
    expect((await sharedMemoryView()).view?.personLabel).toBe("Ada");
  });

  it("carries no person id, owner id, household id, or evidence link", async () => {
    const { view, householdId } = await sharedMemoryView();
    const serialized = JSON.stringify(view);
    for (const secret of ["person-1", OWNER, householdId, "source-1"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("never labels a shared note with the person it resolved to", async () => {
    const { sharing } = await setup([sourceRecord()]);
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "source_record",
      recordId: "source-1",
      visibilityChoice: "whole_household",
    });

    const view = await sharing.readSharedRelationshipRecord({
      callerUserId: MEMBER,
      recordKind: "source_record",
      recordId: "source-1",
    });
    expect(view?.body).toContain("Coffee on Tuesday");
    expect(view?.personLabel).toBeNull();
  });

  it("shares a memory and its evidence independently", async () => {
    const { sharing } = await setup([memory(), sourceRecord()]);
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "whole_household",
    });

    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).not.toBeNull();
    // The note that grounds it stayed private, and the shared memory leaves no
    // trace that it exists at all.
    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "source_record",
        recordId: "source-1",
      }),
    ).toBeNull();
  });

  it("shows the owner their own record without foreign provenance", async () => {
    const { sharing } = await setup();
    const view = await sharing.readSharedRelationshipRecord({
      callerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
    });
    expect(view?.viewerIsOwner).toBe(true);
  });
});

describe("refusals are indistinguishable from absence", () => {
  it("returns nothing for a private record", async () => {
    const { sharing } = await setup();
    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toBeNull();
  });

  it("returns nothing for a record that does not exist", async () => {
    const { sharing } = await setup();
    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-404",
      }),
    ).toBeNull();
  });

  it("returns nothing to a member outside the selected audience", async () => {
    const { sharing } = await setup();
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "selected_members",
      selectedUserIds: [MEMBER],
    });

    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: OTHER_MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toBeNull();
  });

  it("returns nothing to someone outside the household", async () => {
    const { sharing } = await setup();
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "whole_household",
    });

    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: OUTSIDER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toBeNull();
  });

  it("returns nothing for a record scoped past a household it does not have", async () => {
    // A row can only reach this state through a bug or a half-applied write.
    // Fail-closed means the proof refuses it rather than reading the scope as
    // permission on its own.
    const { sharing } = await setup([memory({ scope: "household", householdId: null })]);
    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toBeNull();
  });

  it("returns nothing for a record whose lifecycle has ended", async () => {
    const { sharing } = await setup([memory({ scope: "household", lifecycle: "ended" })]);
    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toBeNull();
  });
});

describe("revocation is immediate", () => {
  it("drops a member removed from the selected audience", async () => {
    const { sharing } = await setup();
    const share = (selectedUserIds: string[]) =>
      sharing.shareRelationshipRecord({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: "memory-1",
        visibilityChoice: "selected_members",
        selectedUserIds,
      });

    await share([MEMBER, OTHER_MEMBER]);
    await share([OTHER_MEMBER]);

    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toBeNull();
    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: OTHER_MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).not.toBeNull();
  });

  it("returns a record to private and clears its shares", async () => {
    const { sharing, store, household } = await setup();
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "selected_members",
      selectedUserIds: [MEMBER],
    });

    const state = await sharing.stopSharingRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
    });

    expect(state.scope).toBe("private");
    expect(
      await store.listHouseholdRecordShares({
        householdId: household.id,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toEqual([]);
    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toBeNull();
  });

  it("ends access the moment a membership does", async () => {
    const { sharing, store, household } = await setup();
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "whole_household",
    });

    await removeHouseholdMember(store, { householdId: household.id, userId: MEMBER });

    expect(
      await sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
      }),
    ).toBeNull();
  });
});

describe("restricted content", () => {
  let restricted: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    restricted = await setup([memory({ sensitivity: "restricted" })]);
  });

  it("refuses to widen restricted content without a second confirmation", async () => {
    await expect(
      restricted.sharing.shareRelationshipRecord({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: "memory-1",
        visibilityChoice: "whole_household",
      }),
    ).rejects.toThrow(/Confirm the audience/);
  });

  it("shares restricted content once the owner confirms", async () => {
    const state = await restricted.sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "whole_household",
      confirmedRestricted: true,
    });
    expect(state.scope).toBe("household");
  });

  it("needs no confirmation to take restricted content back", async () => {
    await restricted.sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "whole_household",
      confirmedRestricted: true,
    });

    const state = await restricted.sharing.stopSharingRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
    });
    expect(state.scope).toBe("private");
  });

  it("keeps shared restricted content out of every ambient surface", async () => {
    await restricted.sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "whole_household",
      confirmedRestricted: true,
    });

    expect(
      await restricted.sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
        purpose: "ambient",
      }),
    ).toBeNull();
    expect(
      await restricted.sharing.readSharedRelationshipRecord({
        callerUserId: MEMBER,
        recordKind: "memory",
        recordId: "memory-1",
        purpose: "direct",
      }),
    ).not.toBeNull();
  });
});

describe("each family shares independently", () => {
  it("carries a follow-up's timing and no trust treatment", async () => {
    const { sharing } = await setup([followup()]);
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "followup",
      recordId: "followup-1",
      visibilityChoice: "whole_household",
    });

    const view = await sharing.readSharedRelationshipRecord({
      callerUserId: MEMBER,
      recordKind: "followup",
      recordId: "followup-1",
    });
    expect(view?.dueAt).toEqual(new Date("2026-06-10T00:00:00Z"));
    expect(view?.trust).toBeNull();
    expect(view?.personLabel).toBe("Ada");
  });

  it("keeps one family's audience out of another's", async () => {
    const { sharing } = await setup([memory(), followup()]);
    await sharing.shareRelationshipRecord({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: "memory-1",
      visibilityChoice: "selected_members",
      selectedUserIds: [MEMBER],
    });

    expect(
      await sharing.listRelationshipShareAudiences({
        ownerUserId: OWNER,
        recordKind: "followup",
        recordIds: ["followup-1"],
      }),
    ).toEqual({});
    expect(
      await sharing.listRelationshipShareAudiences({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordIds: ["memory-1"],
      }),
    ).toEqual({ "memory-1": [MEMBER] });
  });
});
