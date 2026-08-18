import type {
  BriefItem,
  BriefWithItems,
  MemoryCuratorProposal,
  MemoryCuratorProposalResult,
  MessageDraft,
  ScheduledWorkflowDeliveryArtifact,
  Sensitivity,
} from "@tendnote/domain";
import { aggregateArtifactScope } from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../client";
import { briefs } from "../schema";
import { generateBrief } from "./briefs";
import type { CalendarReaderForOwner } from "./calendar";
import { createDrizzleDraftStore } from "./drafts";
import { getMemoryCuratorProposals } from "./memory-curator";
import {
  createDrizzleScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
  type DiscordProactiveDeliverySender,
  type DiscordScheduledArtifactDeliveryResult,
} from "./scheduled-workflow-deliveries";

export type { DiscordProactiveDeliverySender };

export type WeeklyRelationshipReviewSections = {
  staleContext: MemoryCuratorProposal[];
  overdueFollowups: BriefItem[];
  openReviewItems: BriefItem[];
  unresolvedDrafts: MessageDraft[];
  curatorProposals: MemoryCuratorProposalResult;
};

export type GenerateWeeklyRelationshipReviewInput = {
  ownerUserId: string;
  localDate: string;
  now?: Date;
  calendarReaderFor?: CalendarReaderForOwner;
  deliverDiscord?: boolean;
  sender?: DiscordProactiveDeliverySender;
};

export type WeeklyRelationshipReviewWorkflowResult = {
  brief: BriefWithItems;
  sections: WeeklyRelationshipReviewSections;
  artifact: ScheduledWorkflowDeliveryArtifact;
  delivery: DiscordScheduledArtifactDeliveryResult | null;
};

export type WeeklyRelationshipReviewWorkflowDeps = {
  generateBrief: (input: {
    ownerUserId: string;
    cadence: "weekly";
    localDate: string;
    generationReason: "scheduled";
    now?: Date;
    calendarReaderFor?: CalendarReaderForOwner;
  }) => Promise<BriefWithItems>;
  getMemoryCuratorProposals: (input: {
    ownerUserId: string;
    limit?: number;
    now?: Date;
  }) => Promise<MemoryCuratorProposalResult>;
  listUnresolvedDrafts: (input: { ownerUserId: string }) => Promise<MessageDraft[]>;
  persistWeeklyRelationshipReviewSnapshot?: (input: {
    brief: BriefWithItems;
    sections: WeeklyRelationshipReviewSections;
  }) => Promise<BriefWithItems>;
  deliverDiscordScheduledArtifact?: (input: {
    artifact: ScheduledWorkflowDeliveryArtifact;
    sender: DiscordProactiveDeliverySender;
  }) => Promise<DiscordScheduledArtifactDeliveryResult>;
};

export function createWeeklyRelationshipReviewWorkflow(deps: WeeklyRelationshipReviewWorkflowDeps) {
  return {
    async generateWeeklyRelationshipReview(
      input: GenerateWeeklyRelationshipReviewInput,
    ): Promise<WeeklyRelationshipReviewWorkflowResult> {
      const [brief, curatorProposals, unresolvedDrafts] = await Promise.all([
        deps.generateBrief({
          ownerUserId: input.ownerUserId,
          cadence: "weekly",
          localDate: input.localDate,
          generationReason: "scheduled",
          now: input.now,
          calendarReaderFor: input.calendarReaderFor,
        }),
        deps.getMemoryCuratorProposals({
          ownerUserId: input.ownerUserId,
          now: input.now,
          limit: 5,
        }),
        deps.listUnresolvedDrafts({ ownerUserId: input.ownerUserId }),
      ]);
      const sections = buildWeeklyRelationshipReviewSections({
        brief,
        curatorProposals: filterReviewableCuratorProposals(curatorProposals),
        unresolvedDrafts,
        now: input.now ?? new Date(),
      });
      const persistedBrief = deps.persistWeeklyRelationshipReviewSnapshot
        ? await deps.persistWeeklyRelationshipReviewSnapshot({ brief, sections })
        : brief;
      const artifact = toWeeklyRelationshipReviewArtifact(persistedBrief, sections);
      const delivery =
        input.deliverDiscord === true && input.sender && deps.deliverDiscordScheduledArtifact
          ? await deps.deliverDiscordScheduledArtifact({ artifact, sender: input.sender })
          : null;

      return { brief: persistedBrief, sections, artifact, delivery };
    },
  };
}

export function buildWeeklyRelationshipReviewSections(input: {
  brief: BriefWithItems;
  curatorProposals: MemoryCuratorProposalResult;
  unresolvedDrafts: MessageDraft[];
  now: Date;
}): WeeklyRelationshipReviewSections {
  return {
    staleContext: input.curatorProposals.proposals.filter(
      (proposal) => proposal.kind === "stale_memory_archive",
    ),
    overdueFollowups: input.brief.items.filter(
      (item) =>
        item.kind === "due_followup" &&
        item.dueAt !== null &&
        item.dueAt.getTime() < input.now.getTime(),
    ),
    openReviewItems: input.brief.items.filter(
      (item) => item.kind === "review_item" || item.kind === "suggested_followup",
    ),
    unresolvedDrafts: input.unresolvedDrafts,
    curatorProposals: input.curatorProposals,
  };
}

export function toWeeklyRelationshipReviewArtifact(
  brief: BriefWithItems,
  sections: WeeklyRelationshipReviewSections,
): ScheduledWorkflowDeliveryArtifact {
  // Aggregate over everything the review surfaces (ADR-0142). Brief items carry a
  // snapshotted scope; the memory-curator proposals and unresolved drafts are
  // owner-private review surfaces (ADR-0123/0125), so they fail the artifact closed
  // to `private` whenever present. Only a review built solely from household-visible
  // brief items for one household stays `household`.
  const { scope, householdId } = aggregateArtifactScope([
    ...brief.items.map((item) => ({ scope: item.scope, householdId: item.householdId })),
    ...sections.curatorProposals.proposals.map(() => ({ scope: "private" as const })),
    ...sections.unresolvedDrafts.map(() => ({ scope: "private" as const })),
  ]);
  return {
    ownerUserId: brief.ownerUserId,
    workflow: "weekly_relationship_review",
    artifactKind: "weekly_relationship_review",
    artifactId: brief.id,
    sensitivity: maxWeeklyReviewSensitivity([
      ...brief.items.map((item) => item.sensitivity),
      ...sections.curatorProposals.proposals.map((proposal) => proposal.sensitivity),
    ]),
    scope,
    householdId,
    persisted: true,
    summary: weeklyRelationshipReviewSummary(sections),
  };
}

function maxWeeklyReviewSensitivity(sensitivities: Sensitivity[]): Sensitivity {
  if (sensitivities.includes("restricted")) return "restricted";
  if (sensitivities.includes("sensitive")) return "sensitive";
  return "normal";
}

function weeklyRelationshipReviewSummary(sections: WeeklyRelationshipReviewSections): string {
  const count =
    sections.staleContext.length +
    sections.overdueFollowups.length +
    sections.openReviewItems.length +
    sections.unresolvedDrafts.length +
    sections.curatorProposals.proposals.length;

  if (count === 0) {
    return "No weekly relationship review prompts are ready.";
  }
  if (count === 1) {
    return "One weekly relationship review prompt is ready.";
  }
  return `${count} weekly relationship review prompts are ready.`;
}

function filterReviewableCuratorProposals(
  result: MemoryCuratorProposalResult,
): MemoryCuratorProposalResult {
  const proposals = result.proposals.filter((proposal) => proposal.sensitivity !== "restricted");
  return {
    ...result,
    proposals,
    component: { ...result.component, proposalCount: proposals.length },
  };
}

export async function persistWeeklyRelationshipReviewSnapshot(input: {
  brief: BriefWithItems;
  sections: WeeklyRelationshipReviewSections;
}): Promise<BriefWithItems> {
  const snapshot = weeklyRelationshipReviewSnapshot(input.sections);
  const summaryProvenance = {
    ...(input.brief.summaryProvenance ?? {}),
    weeklyRelationshipReview: snapshot,
  };

  await getDb()
    .update(briefs)
    .set({ summaryProvenance, updatedAt: new Date() })
    .where(and(eq(briefs.id, input.brief.id), eq(briefs.ownerUserId, input.brief.ownerUserId)));

  return { ...input.brief, summaryProvenance };
}

function weeklyRelationshipReviewSnapshot(sections: WeeklyRelationshipReviewSections) {
  return {
    staleContext: sections.staleContext.map((proposal) => ({
      id: proposal.id,
      kind: proposal.kind,
      title: proposal.title,
      reason: proposal.reason,
      sourceRefs: proposal.sourceRefs,
      sensitivity: proposal.sensitivity,
      reviewOnly: proposal.reviewOnly,
    })),
    overdueFollowups: sections.overdueFollowups.map((item) => briefItemSnapshot(item)),
    openReviewItems: sections.openReviewItems.map((item) => briefItemSnapshot(item)),
    unresolvedDrafts: sections.unresolvedDrafts.map((draft) => ({
      id: draft.id,
      personId: draft.personId,
      channel: draft.channel,
      purpose: draft.purpose,
      status: draft.status,
      sourceRefs: draft.sourceRefs,
    })),
    curatorProposalCount: sections.curatorProposals.proposals.length,
  };
}

function briefItemSnapshot(item: BriefItem) {
  return {
    id: item.id,
    kind: item.kind,
    personId: item.personId,
    personDisplayName: item.personDisplayName,
    title: item.title,
    reason: item.reason,
    dueAt: item.dueAt?.toISOString() ?? null,
    sourceRefs: item.sourceRefs,
    sensitivity: item.sensitivity,
  };
}

const defaultDeliveryService = createScheduledWorkflowDeliveryService(
  createDrizzleScheduledWorkflowDeliveryStore(),
);
const defaultDraftStore = createDrizzleDraftStore();
const defaultWeeklyRelationshipReviewWorkflow = createWeeklyRelationshipReviewWorkflow({
  generateBrief: (input) => generateBrief(input),
  getMemoryCuratorProposals: (input) => getMemoryCuratorProposals(input),
  listUnresolvedDrafts: (input) =>
    defaultDraftStore.listDraftsForOwner({ ...input, statuses: ["draft"] }),
  persistWeeklyRelationshipReviewSnapshot: (input) =>
    persistWeeklyRelationshipReviewSnapshot(input),
  deliverDiscordScheduledArtifact: (input) =>
    defaultDeliveryService.deliverDiscordScheduledArtifact(input),
});

export function generateWeeklyRelationshipReview(input: GenerateWeeklyRelationshipReviewInput) {
  return defaultWeeklyRelationshipReviewWorkflow.generateWeeklyRelationshipReview(input);
}
