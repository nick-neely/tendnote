import type { TodayCandidate } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryTodayFeedbackStore } from "./in-memory-store";
import { createTodayShortlistService } from "./service";

const NOW = new Date("2026-07-21T15:00:00.000Z");

function candidate(input: {
  id: string;
  family: TodayCandidate["family"];
  mandatory?: boolean;
  createdAt?: string;
}): TodayCandidate {
  return {
    identity: `${input.family}:${input.id}`,
    family: input.family,
    record: {
      kind: input.family === "follow_up" ? "follow_up" : "general_action",
      id: input.id,
      href: input.family === "follow_up" ? `/people/person-1#followup-${input.id}` : "/actions",
    },
    title: `Record ${input.id}`,
    context: "Authoritative context",
    reason: {
      code: input.mandatory ? "due_today" : "aged_after_cooldown",
      key: `reason:${input.id}`,
      explanation: input.mandatory ? "Due today." : "Eligible after its cooldown.",
    },
    sourceRefs: [{ kind: input.family, id: input.id }],
    action: {
      kind: input.family === "follow_up" ? "complete_follow_up" : "open_record",
      label: input.family === "follow_up" ? "Complete" : "Open",
    },
    mandatory: input.mandatory ?? false,
    dueAt: input.mandatory ? new Date("2026-07-21T09:00:00.000Z") : null,
    createdAt: new Date(input.createdAt ?? "2026-06-01T00:00:00.000Z"),
    sensitivity: "normal",
  };
}

describe("Today shortlist product function", () => {
  it("gives Eve only validated optional candidates and falls back without losing mandatory items", async () => {
    const mandatory = candidate({ id: "due", family: "follow_up", mandatory: true });
    const saved = candidate({ id: "saved", family: "saved_item" });
    const review = candidate({ id: "review", family: "review" });
    const rankOptional = vi.fn(
      async (_input: { ownerUserId: string; localDate: string; candidates: TodayCandidate[] }) => {
        throw new Error("Eve unavailable");
      },
    );
    const service = createTodayShortlistService({
      feedbackStore: createInMemoryTodayFeedbackStore(),
      loadCandidateFamilies: [vi.fn(async () => [review, mandatory, saved])],
      rankOptional,
    });

    const result = await service.getTodayShortlist({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      now: NOW,
    });

    expect(rankOptional).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      candidates: expect.arrayContaining([
        expect.objectContaining({ identity: saved.identity, mandatory: false }),
        expect.objectContaining({ identity: review.identity, mandatory: false }),
      ]),
    });
    expect(rankOptional.mock.calls[0]?.[0].candidates).not.toContainEqual(
      expect.objectContaining({ identity: mandatory.identity }),
    );
    expect(result.items.map((item) => item.identity)).toEqual([
      mandatory.identity,
      review.identity,
      saved.identity,
    ]);
    // The fallback is recorded for logs and tests, never told to the owner: the
    // list is complete either way, so there is nothing about it worth their
    // attention (and "deterministic ordering" is not a sentence Tendnote says).
    expect(result.curation).toBe("deterministic_fallback");
    expect(result.limitations).toEqual([]);
  });

  it("records Today-only Later feedback after reloading the authoritative candidate", async () => {
    const action = candidate({ id: "filter", family: "action" });
    const feedbackStore = createInMemoryTodayFeedbackStore();
    const service = createTodayShortlistService({
      feedbackStore,
      loadCandidateFamilies: [vi.fn(async () => [action])],
    });

    const outcome = await service.suppressTodayCandidate({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      now: NOW,
      candidateIdentity: action.identity,
      reasonKey: action.reason.key,
      kind: "later",
      suppressUntil: new Date("2026-07-21T18:00:00.000Z"),
    });
    expect(outcome.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "today", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
    ]);

    await expect(
      service.getTodayShortlist({
        ownerUserId: "owner-1",
        localDate: "2026-07-21",
        now: new Date("2026-07-21T16:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ items: [] });
    expect(feedbackStore.records).toEqual([
      expect.objectContaining({
        ownerUserId: "owner-1",
        candidateIdentity: action.identity,
        reasonKey: action.reason.key,
        kind: "later",
      }),
    ]);

    const restored = await service.restoreTodayCandidate({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      candidateIdentity: action.identity,
      reasonKey: action.reason.key,
      kind: "later",
    });

    expect(restored.affectedScopes).toEqual(outcome.affectedScopes);
    expect(feedbackStore.auditEntries.at(-1)).toMatchObject({
      action: "today.feedback_restored",
      entityId: action.identity,
    });
    await expect(
      service.getTodayShortlist({
        ownerUserId: "owner-1",
        localDate: "2026-07-21",
        now: new Date("2026-07-21T16:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ identity: action.identity })] });
  });

  it("accepts only supplied optional identities while keeping deterministic facts and actions", async () => {
    const mandatory = candidate({ id: "due", family: "follow_up", mandatory: true });
    const saved = candidate({ id: "saved", family: "saved_item" });
    const review = candidate({ id: "review", family: "review" });
    const service = createTodayShortlistService({
      feedbackStore: createInMemoryTodayFeedbackStore(),
      loadCandidateFamilies: [vi.fn(async () => [mandatory, saved, review])],
      rankOptional: vi.fn(async () => ({
        orderedIdentities: [review.identity, "action:invented", saved.identity],
      })),
    });

    const result = await service.getTodayShortlist({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      now: NOW,
    });

    expect(result.items.map((item) => item.identity)).toEqual([
      mandatory.identity,
      review.identity,
      saved.identity,
    ]);
    expect(result.items[0]?.reason.explanation).toBe(mandatory.reason.explanation);
    expect(result.items[1]?.reason.explanation).toBe(review.reason.explanation);
    expect(result.items[1]?.action).toEqual(review.action);
    expect(result.items.some((item) => item.identity === "action:invented")).toBe(false);
    expect(result.curation).toBe("eve_ranked");
  });

  it("reuses the Eve order while the eligible fingerprint and local day stay unchanged", async () => {
    const saved = candidate({ id: "saved", family: "saved_item" });
    const review = candidate({ id: "review", family: "review" });
    let savedTitle = saved.title;
    const rankOptional = vi.fn(async () => ({
      orderedIdentities: [saved.identity, review.identity],
    }));
    const service = createTodayShortlistService({
      feedbackStore: createInMemoryTodayFeedbackStore(),
      loadCandidateFamilies: [vi.fn(async () => [review, { ...saved, title: savedTitle }])],
      rankOptional,
    });

    const first = await service.getTodayShortlist({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      now: NOW,
    });
    const stable = await service.getTodayShortlist({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      now: NOW,
    });
    savedTitle = "Updated authoritative title";
    const changed = await service.getTodayShortlist({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      now: NOW,
    });
    await service.getTodayShortlist({
      ownerUserId: "owner-1",
      localDate: "2026-07-21",
      now: NOW,
      forceRefresh: true,
    });

    expect(stable.items.map((item) => item.identity)).toEqual(
      first.items.map((item) => item.identity),
    );
    expect(changed.candidateFingerprint).not.toBe(first.candidateFingerprint);
    expect(rankOptional).toHaveBeenCalledTimes(3);
  });

  it("audits both Today feedback inserts and updates without copying record content", async () => {
    const store = createInMemoryTodayFeedbackStore();
    const input = {
      ownerUserId: "owner-1",
      candidateIdentity: "saved_item:filter",
      reasonKey: "bring-back:2026-07-21",
      kind: "later" as const,
      localDate: "2026-07-21",
      suppressUntil: new Date("2026-07-21T18:00:00.000Z"),
    };

    await store.saveFeedback(input);
    await store.saveFeedback({ ...input, suppressUntil: new Date("2026-07-21T19:00:00.000Z") });

    expect(store.records).toHaveLength(1);
    expect(store.auditEntries).toEqual([
      expect.objectContaining({
        action: "today.feedback_saved",
        entityId: "saved_item:filter",
        metadataJson: expect.objectContaining({ kind: "later" }),
      }),
      expect.objectContaining({
        action: "today.feedback_saved",
        entityId: "saved_item:filter",
        metadataJson: expect.objectContaining({ suppressUntil: "2026-07-21T19:00:00.000Z" }),
      }),
    ]);
    expect(JSON.stringify(store.auditEntries)).not.toContain("Filter measurements");
  });
});
