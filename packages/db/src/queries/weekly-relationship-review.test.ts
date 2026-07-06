import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BriefItem,
  BriefItemKind,
  BriefWithItems,
  MemoryCuratorProposalResult,
  MessageDraft,
} from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
} from "./scheduled-workflow-deliveries";
import {
  createWeeklyRelationshipReviewWorkflow,
  type WeeklyRelationshipReviewSections,
} from "./weekly-relationship-review";

const OWNER = "owner-1";
const PERSON_ID = "person-1";
const NOW = new Date("2026-07-06T09:00:00.000Z");

function briefItem(kind: BriefItemKind, overrides: Partial<BriefItem> = {}): BriefItem {
  const now = new Date("2026-07-06T08:00:00.000Z");
  return {
    id: `${kind}-item`,
    briefId: "brief-1",
    ownerUserId: OWNER,
    kind,
    personId: PERSON_ID,
    personDisplayName: "Maya",
    title: `${kind} title`,
    reason: `${kind} reason`,
    dueAt: null,
    sourceRefs: [{ kind: kind === "due_followup" ? "followup" : "source_record", id: `${kind}-1` }],
    trustLevel: kind === "due_followup" ? "active_reminder" : "logged_context",
    sensitivity: "normal",
    scope: "private",
    householdId: null,
    rank: 1,
    status: "active",
    snoozedUntil: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function weeklyBrief(items: BriefItem[] = []): BriefWithItems {
  const now = new Date("2026-07-06T08:00:00.000Z");
  return {
    id: "brief-1",
    ownerUserId: OWNER,
    cadence: "weekly",
    localDate: "2026-07-06",
    generationReason: "scheduled",
    generatedAt: now,
    windowStart: new Date("2026-07-06T00:00:00.000Z"),
    windowEnd: new Date("2026-07-13T00:00:00.000Z"),
    summary: null,
    summaryProvenance: null,
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
    items,
  };
}

function curatorResult(
  input: Partial<MemoryCuratorProposalResult> = {},
): MemoryCuratorProposalResult {
  return {
    ownerUserId: OWNER,
    proposals: [
      {
        id: "curator-1",
        ownerUserId: OWNER,
        kind: "stale_memory_archive",
        personId: PERSON_ID,
        personDisplayName: "Maya",
        title: "Possibly stale memory for Maya",
        reason: "Low-confidence memory has not changed in over a year.",
        suggestedAction: "Review whether this memory is still useful.",
        sourceRefs: [{ kind: "memory", id: "memory-1", label: "Old memory" }],
        sensitivity: "normal",
        reviewOnly: true,
      },
    ],
    component: { type: "memory_curator_proposals", proposalCount: 1 },
    ...input,
  };
}

function curatorProposal() {
  const proposal = curatorResult().proposals[0];
  if (!proposal) {
    throw new Error("Expected curator proposal fixture.");
  }
  return proposal;
}

function draft(overrides: Partial<MessageDraft> = {}): MessageDraft {
  const now = new Date("2026-07-06T08:00:00.000Z");
  return {
    id: "draft-1",
    ownerUserId: OWNER,
    personId: PERSON_ID,
    channel: "text",
    purpose: "check_in",
    body: "Draft body",
    status: "draft",
    sourceRefs: [
      { kind: "approved_memory", id: "memory-1", label: "Grounding", trust: "confirmed_fact" },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setupWorkflow(
  input: {
    brief?: BriefWithItems;
    curator?: MemoryCuratorProposalResult;
    drafts?: MessageDraft[];
    deliverDiscord?: boolean;
  } = {},
) {
  const delivery = createScheduledWorkflowDeliveryService(
    createInMemoryScheduledWorkflowDeliveryStore(),
  );
  const workflow = createWeeklyRelationshipReviewWorkflow({
    generateBrief: vi.fn(async () => input.brief ?? weeklyBrief()),
    getMemoryCuratorProposals: vi.fn(async () => input.curator ?? curatorResult()),
    listUnresolvedDrafts: vi.fn(async () => input.drafts ?? []),
    deliverDiscordScheduledArtifact: input.deliverDiscord
      ? (args) => delivery.deliverDiscordScheduledArtifact(args)
      : undefined,
  });

  return { workflow, delivery };
}

describe("Weekly Relationship Review workflow", () => {
  it("persists a weekly review artifact through the shared weekly brief generator", async () => {
    const items = [
      briefItem("due_followup", { dueAt: new Date("2026-07-01T12:00:00.000Z") }),
      briefItem("review_item", { sensitivity: "sensitive" }),
      briefItem("recent_context"),
      briefItem("suggested_followup"),
    ];
    const generatedBrief = weeklyBrief(items);
    const generateBrief = vi.fn(async () => generatedBrief);
    const persistWeeklyRelationshipReviewSnapshot = vi.fn(
      async (input: { brief: BriefWithItems; sections: WeeklyRelationshipReviewSections }) => ({
        ...input.brief,
        summaryProvenance: {
          weeklyRelationshipReview: {
            staleContext: input.sections.staleContext.map((proposal) => proposal.id),
            unresolvedDrafts: input.sections.unresolvedDrafts.map((draft) => draft.id),
          },
        },
      }),
    );
    const workflow = createWeeklyRelationshipReviewWorkflow({
      generateBrief,
      getMemoryCuratorProposals: vi.fn(async () => curatorResult()),
      listUnresolvedDrafts: vi.fn(async () => [draft()]),
      persistWeeklyRelationshipReviewSnapshot,
    });

    const result = await workflow.generateWeeklyRelationshipReview({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: NOW,
    });

    expect(result.brief.summaryProvenance).toEqual({
      weeklyRelationshipReview: { staleContext: ["curator-1"], unresolvedDrafts: ["draft-1"] },
    });
    expect(result.artifact).toMatchObject({
      ownerUserId: OWNER,
      workflow: "weekly_relationship_review",
      artifactKind: "weekly_relationship_review",
      artifactId: generatedBrief.id,
      persisted: true,
      sensitivity: "sensitive",
      // Review surfaces (brief items, curator proposals, drafts) are owner-private,
      // so the artifact fails closed to private (ADR-0142).
      scope: "private",
      householdId: null,
    });
    expect(generateBrief).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      cadence: "weekly",
      localDate: "2026-07-06",
      generationReason: "scheduled",
      now: NOW,
    });
    expect(persistWeeklyRelationshipReviewSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: generatedBrief,
        sections: expect.objectContaining({
          staleContext: expect.arrayContaining([expect.objectContaining({ id: "curator-1" })]),
          unresolvedDrafts: expect.arrayContaining([expect.objectContaining({ id: "draft-1" })]),
        }),
      }),
    );
  });

  it("builds bounded sections for stale curator context, overdue follow-ups, open review items, and drafts", async () => {
    const { workflow } = setupWorkflow({
      brief: weeklyBrief([
        briefItem("recent_context"),
        briefItem("due_followup", { dueAt: new Date("2026-07-01T12:00:00.000Z") }),
        briefItem("due_followup", { id: "future", dueAt: new Date("2026-07-10T12:00:00.000Z") }),
        briefItem("review_item"),
        briefItem("suggested_followup"),
      ]),
      drafts: [draft()],
    });

    const result = await workflow.generateWeeklyRelationshipReview({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: NOW,
    });

    expect(result.sections.staleContext.map((proposal) => proposal.kind)).toEqual([
      "stale_memory_archive",
    ]);
    expect(result.sections.overdueFollowups).toHaveLength(1);
    expect(result.sections.openReviewItems.map((item) => item.kind)).toEqual([
      "review_item",
      "suggested_followup",
    ]);
    expect(result.sections.curatorProposals.proposals).toHaveLength(1);
    expect(result.sections.unresolvedDrafts).toHaveLength(1);
  });

  it("filters restricted curator proposals and computes artifact sensitivity across review sections", async () => {
    const { workflow } = setupWorkflow({
      curator: curatorResult({
        proposals: [
          {
            ...curatorProposal(),
            id: "sensitive-curator",
            sensitivity: "sensitive",
          },
          {
            ...curatorProposal(),
            id: "restricted-curator",
            sensitivity: "restricted",
          },
        ],
        component: { type: "memory_curator_proposals", proposalCount: 2 },
      }),
    });

    const result = await workflow.generateWeeklyRelationshipReview({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: NOW,
    });

    expect(result.sections.curatorProposals.proposals.map((proposal) => proposal.id)).toEqual([
      "sensitive-curator",
    ]);
    expect(result.artifact.sensitivity).toBe("sensitive");
  });

  it("is idempotent through the weekly brief seam", async () => {
    const generatedBrief = weeklyBrief();
    const generateBrief = vi.fn(async () => generatedBrief);
    const workflow = createWeeklyRelationshipReviewWorkflow({
      generateBrief,
      getMemoryCuratorProposals: vi.fn(async () => curatorResult({ proposals: [] })),
      listUnresolvedDrafts: vi.fn(async () => []),
    });

    const first = await workflow.generateWeeklyRelationshipReview({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: NOW,
    });
    const second = await workflow.generateWeeklyRelationshipReview({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: NOW,
    });

    expect(second.brief.id).toBe(first.brief.id);
    expect(generateBrief).toHaveBeenCalledTimes(2);
    expect(generateBrief).toHaveBeenCalledWith(expect.objectContaining({ cadence: "weekly" }));
  });

  it("uses configured Discord delivery after the weekly artifact is persisted", async () => {
    const { workflow, delivery } = setupWorkflow({ deliverDiscord: true });
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "weekly_relationship_review",
      enabled: true,
      targetId: "discord-weekly",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => undefined);

    const result = await workflow.generateWeeklyRelationshipReview({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: NOW,
      deliverDiscord: true,
      sender,
    });

    expect(result.delivery).toMatchObject({
      type: "sent",
      attempt: { artifactId: result.brief.id, artifactKind: "weekly_relationship_review" },
    });
    expect(sender).toHaveBeenCalledWith({
      targetId: "discord-weekly",
      content: expect.stringContaining("weekly relationship review is ready for review"),
    });
  });

  it("keeps the persisted weekly artifact reviewable when Discord delivery fails", async () => {
    const { workflow, delivery } = setupWorkflow({ deliverDiscord: true });
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "weekly_relationship_review",
      enabled: true,
      targetId: "discord-weekly",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => {
      throw new Error("Discord unavailable");
    });

    const result = await workflow.generateWeeklyRelationshipReview({
      ownerUserId: OWNER,
      localDate: "2026-07-06",
      now: NOW,
      deliverDiscord: true,
      sender,
    });

    expect(result.brief.id).toBe("brief-1");
    expect(result.delivery).toMatchObject({
      type: "failed",
      error: "Discord unavailable",
      attempt: { artifactId: "brief-1", status: "failed" },
    });
  });

  it("does not import autonomous follow-up, memory, source-record, draft, or external-send mutations", () => {
    const source = readFileSync(
      join(process.cwd(), "src/queries/weekly-relationship-review.ts"),
      "utf8",
    );
    const importSources = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

    for (const moduleId of importSources) {
      expect(moduleId).not.toMatch(/queries\/(followups|memories|source-records|gmail)/);
      expect(moduleId).not.toMatch(/sendgrid|twilio|slack|resend|nodemailer/i);
    }
  });
});
