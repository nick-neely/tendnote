import { describe, expect, it } from "vitest";
import {
  assertAudienceExcludesSurpriseSubject,
  assertGiftIdeaContributor,
  assertGiftPlanAcceptsCommitments,
  assertGiftPlanOpen,
  assertGiftRecordFresh,
  assertSurpriseSubjectEligible,
  audienceWithoutSurpriseSubject,
  GiftPlanConflictError,
  GiftPlanValidationError,
  giftPlanAcceptsCommitments,
  giftPlanExclusions,
  resolveGiftIdeaClaim,
  resolveGiftPlanTransition,
} from "./gift-plans";

describe("giftPlanExclusions", () => {
  it("names the Surprise Subject so the proof's exclusion gate can deny them", () => {
    expect(giftPlanExclusions({ surpriseSubjectUserId: "subject" })).toEqual(["subject"]);
  });

  it("is empty rather than absent when no one is protected", () => {
    expect(giftPlanExclusions({ surpriseSubjectUserId: null })).toEqual([]);
  });
});

describe("assertSurpriseSubjectEligible", () => {
  it("refuses the owner, who would otherwise lock themselves out", () => {
    expect(() =>
      assertSurpriseSubjectEligible({
        ownerUserId: "owner",
        surpriseSubjectUserId: "owner",
        activeMemberUserIds: ["owner", "partner"],
      }),
    ).toThrow(GiftPlanValidationError);
  });

  it("refuses someone who is not an active household member", () => {
    expect(() =>
      assertSurpriseSubjectEligible({
        ownerUserId: "owner",
        surpriseSubjectUserId: "stranger",
        activeMemberUserIds: ["owner", "partner"],
      }),
    ).toThrow(/active member/);
  });

  it("admits an active member who is not the owner", () => {
    expect(() =>
      assertSurpriseSubjectEligible({
        ownerUserId: "owner",
        surpriseSubjectUserId: "partner",
        activeMemberUserIds: ["owner", "partner"],
      }),
    ).not.toThrow();
  });
});

describe("surprise subject and audience", () => {
  it("refuses an audience that names the Surprise Subject", () => {
    expect(() =>
      assertAudienceExcludesSurpriseSubject({
        surpriseSubjectUserId: "partner",
        selectedUserIds: ["sibling", "partner"],
      }),
    ).toThrow(/surprise/i);
  });

  it("allows an audience that does not", () => {
    expect(() =>
      assertAudienceExcludesSurpriseSubject({
        surpriseSubjectUserId: "partner",
        selectedUserIds: ["sibling"],
      }),
    ).not.toThrow();
  });

  it("strips the Surprise Subject when protection is applied to an existing audience", () => {
    expect(
      audienceWithoutSurpriseSubject({
        surpriseSubjectUserId: "partner",
        selectedUserIds: ["sibling", "partner", "cousin"],
      }),
    ).toEqual(["sibling", "cousin"]);
  });
});

describe("gift plan lifecycle", () => {
  it("names the event for each allowed transition", () => {
    expect(resolveGiftPlanTransition({ from: "active", to: "celebrated" })).toBe("celebrated");
    expect(resolveGiftPlanTransition({ from: "celebrated", to: "archived" })).toBe("archived");
    expect(resolveGiftPlanTransition({ from: "archived", to: "active" })).toBe("reopened");
  });

  it("refuses a transition the plan cannot make", () => {
    expect(() => resolveGiftPlanTransition({ from: "archived", to: "celebrated" })).toThrow(
      GiftPlanValidationError,
    );
  });

  it("holds edits off an archived plan", () => {
    expect(() => assertGiftPlanOpen({ status: "archived" })).toThrow(/archived/i);
    expect(() => assertGiftPlanOpen({ status: "celebrated" })).not.toThrow();
  });

  it("stops taking commitments once the occasion has been marked celebrated", () => {
    expect(giftPlanAcceptsCommitments({ status: "active" })).toBe(true);
    expect(giftPlanAcceptsCommitments({ status: "celebrated" })).toBe(false);
    expect(giftPlanAcceptsCommitments({ status: "archived" })).toBe(false);
  });

  it("names what happened and the move that reopens it", () => {
    expect(() => assertGiftPlanAcceptsCommitments({ status: "celebrated" })).toThrow(
      /marked celebrated\. Reopen it/,
    );
    // Archived is still reported as archived rather than collapsed into one
    // message: the two states are undone by different moves.
    expect(() => assertGiftPlanAcceptsCommitments({ status: "archived" })).toThrow(/archived/i);
    expect(() => assertGiftPlanAcceptsCommitments({ status: "active" })).not.toThrow();
  });
});

describe("assertGiftIdeaContributor", () => {
  it("refuses anyone but the contributor, including the plan owner", () => {
    expect(() =>
      assertGiftIdeaContributor({ idea: { contributorUserId: "sibling" }, actorUserId: "owner" }),
    ).toThrow(/added an idea/);
  });

  it("admits the contributor", () => {
    expect(() =>
      assertGiftIdeaContributor({ idea: { contributorUserId: "sibling" }, actorUserId: "sibling" }),
    ).not.toThrow();
  });
});

describe("resolveGiftIdeaClaim", () => {
  const idea = { title: "Wool blanket", revision: 3 };

  it("claims an unclaimed idea for the caller", () => {
    expect(
      resolveGiftIdeaClaim({
        idea: { ...idea, claimedByUserId: null },
        actorUserId: "sibling",
        intent: "claim",
      }),
    ).toEqual({ claimedByUserId: "sibling" });
  });

  it("is idempotent for the current claimant", () => {
    expect(
      resolveGiftIdeaClaim({
        idea: { ...idea, claimedByUserId: "sibling" },
        actorUserId: "sibling",
        intent: "claim",
      }),
    ).toEqual({ claimedByUserId: "sibling" });
  });

  it("tells a concurrent claimant who has it rather than double-claiming", () => {
    try {
      resolveGiftIdeaClaim({
        idea: { ...idea, claimedByUserId: "cousin" },
        actorUserId: "sibling",
        intent: "claim",
      });
      expect.unreachable("a claimed idea must not be claimable again");
    } catch (error) {
      expect(error).toBeInstanceOf(GiftPlanConflictError);
      expect((error as GiftPlanConflictError).conflict.actorUserId).toBe("cousin");
    }
  });

  it("releases only the caller's own claim", () => {
    expect(
      resolveGiftIdeaClaim({
        idea: { ...idea, claimedByUserId: "sibling" },
        actorUserId: "sibling",
        intent: "release",
      }),
    ).toEqual({ claimedByUserId: null });
    expect(() =>
      resolveGiftIdeaClaim({
        idea: { ...idea, claimedByUserId: "cousin" },
        actorUserId: "sibling",
        intent: "release",
      }),
    ).toThrow(/claimed an idea/);
  });
});

describe("assertGiftRecordFresh", () => {
  const current = { revision: 7, lastActorUserId: "cousin" };

  it("passes when the writer saw the current revision", () => {
    expect(() =>
      assertGiftRecordFresh({
        expectedRevision: 7,
        current,
        currentValue: "Wool blanket",
        message: "moved",
      }),
    ).not.toThrow();
  });

  it("treats an absent expectation as an explicit replace", () => {
    expect(() =>
      assertGiftRecordFresh({
        expectedRevision: null,
        current,
        currentValue: "Wool blanket",
        message: "moved",
      }),
    ).not.toThrow();
  });

  it("reports the current value and actor when the record moved", () => {
    try {
      assertGiftRecordFresh({
        expectedRevision: 6,
        current,
        currentValue: "Wool blanket",
        message: "moved",
      });
      expect.unreachable("a stale write must not be accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(GiftPlanConflictError);
      expect((error as GiftPlanConflictError).conflict).toEqual({
        currentValue: "Wool blanket",
        actorUserId: "cousin",
        revision: 7,
      });
    }
  });
});
