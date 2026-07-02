import type {
  DraftProposalResult,
  ScheduledWorkflowDeliveryArtifact,
  Sensitivity,
} from "@tendnote/domain";
import { computeNextBriefRun, formatLocalDate } from "@tendnote/domain";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  type BirthdayGiftPlanningProposalJson,
  birthdayGiftPlanningArtifacts,
  birthdayGiftPlanningSchedules,
} from "../schema";
import { proposeDraft } from "./draft-proposals";
import type { RelationshipAgendaCandidate } from "./relationship-agenda";
import { getRelationshipAgenda } from "./relationship-agenda";
import {
  createDrizzleScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
  type DiscordProactiveDeliverySender,
  type DiscordScheduledArtifactDeliveryResult,
} from "./scheduled-workflow-deliveries";

export type { DiscordProactiveDeliverySender };

export type BirthdayGiftPlanningArtifact = {
  id: string;
  ownerUserId: string;
  localDate: string;
  windowStart: Date;
  windowEnd: Date;
  summary: string;
  sensitivity: Sensitivity;
  birthdayKeys: string[];
  proposals: BirthdayGiftPlanningProposalJson[];
  createdAt: Date;
  updatedAt: Date;
};

export type BirthdayGiftPlanningSchedule = {
  id: string;
  ownerUserId: string;
  timezone: string;
  runAtMinute: number;
  nextRunAt: Date;
  enabled: boolean;
  leaseExpiresAt: Date | null;
  attempts: number;
  lastError: string | null;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GenerateBirthdayGiftPlanningInput = {
  ownerUserId: string;
  localDate: string;
  now?: Date;
  deliverDiscord?: boolean;
  sender?: DiscordProactiveDeliverySender;
};

export type BirthdayGiftPlanningWorkflowResult = {
  artifactRecord: BirthdayGiftPlanningArtifact;
  artifact: ScheduledWorkflowDeliveryArtifact;
  delivery: DiscordScheduledArtifactDeliveryResult | null;
};

export type BirthdayGiftPlanningWorkflowDeps = {
  getRelationshipAgenda: (input: {
    ownerUserId: string;
    windowStart: Date;
    windowEnd: Date;
    query: string;
    includeKinds: ["birthday"];
    limit: number;
  }) => Promise<RelationshipAgendaCandidate[]>;
  proposeDraft: (input: {
    ownerUserId: string;
    personId: string;
    purpose: "birthday";
    briefItemContext: { id: string; title: string; reason?: string };
  }) => Promise<DraftProposalResult>;
  store: BirthdayGiftPlanningStore;
  deliverDiscordScheduledArtifact?: (input: {
    artifact: ScheduledWorkflowDeliveryArtifact;
    sender: DiscordProactiveDeliverySender;
  }) => Promise<DiscordScheduledArtifactDeliveryResult>;
};

export type BirthdayGiftPlanningStore = {
  findArtifact: (input: {
    ownerUserId: string;
    localDate: string;
  }) => Promise<BirthdayGiftPlanningArtifact | null>;
  findArtifactForBirthdayKey: (input: {
    ownerUserId: string;
    birthdayKey: string;
  }) => Promise<BirthdayGiftPlanningArtifact | null>;
  createArtifact: (input: {
    ownerUserId: string;
    localDate: string;
    windowStart: Date;
    windowEnd: Date;
    summary: string;
    sensitivity: Sensitivity;
    birthdayKeys: string[];
    proposals: BirthdayGiftPlanningProposalJson[];
  }) => Promise<BirthdayGiftPlanningArtifact>;
  ensureSchedule: (input: {
    ownerUserId: string;
    timezone: string;
    now: Date;
  }) => Promise<BirthdayGiftPlanningSchedule>;
  claimDueSchedule: (input: {
    ownerUserId: string;
    now: Date;
    leaseMs: number;
  }) => Promise<BirthdayGiftPlanningSchedule | null>;
  completeSchedule: (input: {
    id: string;
    nextRunAt: Date;
    ranAt: Date;
  }) => Promise<BirthdayGiftPlanningSchedule>;
  releaseSchedule: (input: {
    id: string;
    lastError: string;
    nextRunAt?: Date;
  }) => Promise<BirthdayGiftPlanningSchedule>;
};

const PLANNING_WINDOW_DAYS = 30;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RUN_AT_MINUTE = 9 * 60;

export function createBirthdayGiftPlanningWorkflow(deps: BirthdayGiftPlanningWorkflowDeps) {
  return {
    async generateBirthdayGiftPlanning(
      input: GenerateBirthdayGiftPlanningInput,
    ): Promise<BirthdayGiftPlanningWorkflowResult> {
      const existing = await deps.store.findArtifact({
        ownerUserId: input.ownerUserId,
        localDate: input.localDate,
      });
      if (existing) {
        return deliver(existing, input, deps);
      }

      const windowStart = new Date(`${input.localDate}T00:00:00.000Z`);
      const windowEnd = addUtcDays(windowStart, PLANNING_WINDOW_DAYS);
      const birthdays = await unplannedBirthdays(
        await deps.getRelationshipAgenda({
          ownerUserId: input.ownerUserId,
          windowStart,
          windowEnd,
          query: "birthday gift planning",
          includeKinds: ["birthday"],
          limit: 10,
        }),
        input.ownerUserId,
        deps.store,
      );

      const proposals = (
        await Promise.all(
          birthdays.map((candidate) => birthdayProposal(input.ownerUserId, candidate, deps)),
        )
      ).filter((proposal): proposal is BirthdayGiftPlanningProposalJson => proposal !== null);
      const artifactRecord = await deps.store.createArtifact({
        ownerUserId: input.ownerUserId,
        localDate: input.localDate,
        windowStart,
        windowEnd,
        summary: birthdayGiftPlanningSummary(proposals.length),
        sensitivity: maxSensitivity(proposals.map((proposal) => proposal.sensitivity)),
        birthdayKeys: proposals.map((proposal) => proposal.id),
        proposals,
      });

      return deliver(artifactRecord, input, deps);
    },
  };
}

async function unplannedBirthdays(
  candidates: RelationshipAgendaCandidate[],
  ownerUserId: string,
  store: BirthdayGiftPlanningStore,
): Promise<RelationshipAgendaCandidate[]> {
  const eligible = candidates.filter(
    (candidate) => candidate.kind === "birthday" && candidate.sensitivity !== "restricted",
  );
  const unplanned: RelationshipAgendaCandidate[] = [];

  for (const candidate of eligible) {
    const key = birthdayPlanningKey(candidate);
    const existing = key
      ? await store.findArtifactForBirthdayKey({ ownerUserId, birthdayKey: key })
      : null;
    if (!existing) {
      unplanned.push(candidate);
    }
  }

  return unplanned;
}

async function birthdayProposal(
  ownerUserId: string,
  candidate: RelationshipAgendaCandidate,
  deps: BirthdayGiftPlanningWorkflowDeps,
): Promise<BirthdayGiftPlanningProposalJson | null> {
  if (!candidate.personId || !candidate.personDisplayName || !candidate.dueAt) {
    throw new Error("Birthday planning requires a resolved person and birthday date.");
  }

  const draft = await deps.proposeDraft({
    ownerUserId,
    personId: candidate.personId,
    purpose: "birthday",
    briefItemContext: {
      id: candidate.sourceRefs[0]?.id ?? candidate.personId,
      title: candidate.title,
      reason: candidate.reason,
    },
  });
  const sourceRefs = groundedSourceRefs(candidate, draft);

  if (!draft.proposal && sourceRefs.length <= 1) {
    return null;
  }

  return {
    id: birthdayPlanningKey(candidate) ?? `birthday_gift:${candidate.personId}:unknown`,
    personId: candidate.personId,
    personDisplayName: candidate.personDisplayName,
    birthday: candidate.dueAt.toISOString().slice(5, 10),
    birthdayDate: candidate.dueAt.toISOString(),
    title: candidate.title,
    reason: candidate.reason,
    giftIdeas: giftIdeasFor(candidate, draft),
    draftProposal: draft.proposal,
    sourceRefs,
    sensitivity: candidate.sensitivity,
    reviewOnly: true,
  };
}

function birthdayPlanningKey(candidate: RelationshipAgendaCandidate): string | null {
  if (!candidate.personId || !candidate.dueAt) return null;
  return `birthday_gift:${candidate.personId}:${candidate.dueAt.toISOString().slice(5, 10)}`;
}

function groundedSourceRefs(
  candidate: RelationshipAgendaCandidate,
  draft: DraftProposalResult,
): BirthdayGiftPlanningProposalJson["sourceRefs"] {
  const refs = [...candidate.sourceRefs, ...(draft.proposal?.sourceRefs ?? [])]
    .filter((ref) => typeof ref.kind === "string" && typeof ref.id === "string")
    .map((ref): BirthdayGiftPlanningProposalJson["sourceRefs"][number] => ({
      kind: ref.kind,
      id: ref.id,
      ...("label" in ref && typeof ref.label === "string" ? { label: ref.label } : {}),
      ...("trust" in ref && typeof ref.trust === "string" ? { trust: ref.trust } : {}),
    }));
  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()];
}

function giftIdeasFor(
  candidate: RelationshipAgendaCandidate,
  draft: DraftProposalResult,
): string[] {
  const ideas = [
    `Use the birthday context: ${candidate.reason}`,
    "Keep any birthday note low-pressure and owner-approved before sending.",
  ];

  if (draft.proposal?.variants[0]?.body) {
    ideas.unshift(
      `Pair the gift plan with the review-only ${draft.proposal.variants[0].label.toLowerCase()} draft proposal.`,
    );
  }

  return ideas;
}

async function deliver(
  artifactRecord: BirthdayGiftPlanningArtifact,
  input: GenerateBirthdayGiftPlanningInput,
  deps: BirthdayGiftPlanningWorkflowDeps,
): Promise<BirthdayGiftPlanningWorkflowResult> {
  const artifact = toBirthdayGiftPlanningDeliveryArtifact(artifactRecord);
  const delivery =
    input.deliverDiscord === true && input.sender && deps.deliverDiscordScheduledArtifact
      ? await deps.deliverDiscordScheduledArtifact({ artifact, sender: input.sender })
      : null;

  return { artifactRecord, artifact, delivery };
}

export function toBirthdayGiftPlanningDeliveryArtifact(
  artifact: BirthdayGiftPlanningArtifact,
): ScheduledWorkflowDeliveryArtifact {
  return {
    ownerUserId: artifact.ownerUserId,
    workflow: "birthday_gift_planning",
    artifactKind: "birthday_gift_planning",
    artifactId: artifact.id,
    sensitivity: artifact.sensitivity,
    persisted: true,
    summary: artifact.summary,
  };
}

function birthdayGiftPlanningSummary(count: number): string {
  if (count === 0) return "No birthday planning proposals are ready.";
  if (count === 1) return "One birthday planning proposal is ready.";
  return `${count} birthday planning proposals are ready.`;
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function maxSensitivity(sensitivities: Sensitivity[]): Sensitivity {
  if (sensitivities.includes("restricted")) return "restricted";
  if (sensitivities.includes("sensitive")) return "sensitive";
  return "normal";
}

function rowToArtifact(
  row: typeof birthdayGiftPlanningArtifacts.$inferSelect,
): BirthdayGiftPlanningArtifact {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    localDate: row.localDate,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    summary: row.summary,
    sensitivity: row.sensitivity,
    birthdayKeys: row.birthdayKeys,
    proposals: row.proposals,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToSchedule(
  row: typeof birthdayGiftPlanningSchedules.$inferSelect,
): BirthdayGiftPlanningSchedule {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    timezone: row.timezone,
    runAtMinute: row.runAtMinute,
    nextRunAt: row.nextRunAt,
    enabled: row.enabled,
    leaseExpiresAt: row.leaseExpiresAt,
    attempts: row.attempts,
    lastError: row.lastError,
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleBirthdayGiftPlanningStore(): BirthdayGiftPlanningStore {
  return {
    async findArtifact(input) {
      const [row] = await getDb()
        .select()
        .from(birthdayGiftPlanningArtifacts)
        .where(
          and(
            eq(birthdayGiftPlanningArtifacts.ownerUserId, input.ownerUserId),
            eq(birthdayGiftPlanningArtifacts.localDate, input.localDate),
          ),
        )
        .limit(1);

      return row ? rowToArtifact(row) : null;
    },
    async findArtifactForBirthdayKey(input) {
      const [row] = await getDb()
        .select()
        .from(birthdayGiftPlanningArtifacts)
        .where(
          and(
            eq(birthdayGiftPlanningArtifacts.ownerUserId, input.ownerUserId),
            sql`${input.birthdayKey} = any(${birthdayGiftPlanningArtifacts.birthdayKeys})`,
          ),
        )
        .orderBy(asc(birthdayGiftPlanningArtifacts.createdAt))
        .limit(1);

      return row ? rowToArtifact(row) : null;
    },
    async createArtifact(input) {
      const [row] = await getDb().insert(birthdayGiftPlanningArtifacts).values(input).returning();

      if (!row) {
        throw new Error("Failed to create birthday gift planning artifact.");
      }
      return rowToArtifact(row);
    },
    async ensureSchedule(input) {
      const [existing] = await getDb()
        .select()
        .from(birthdayGiftPlanningSchedules)
        .where(eq(birthdayGiftPlanningSchedules.ownerUserId, input.ownerUserId))
        .limit(1);
      if (existing) return rowToSchedule(existing);

      const [row] = await getDb()
        .insert(birthdayGiftPlanningSchedules)
        .values({
          ownerUserId: input.ownerUserId,
          timezone: input.timezone,
          runAtMinute: DEFAULT_RUN_AT_MINUTE,
          nextRunAt: computeNextBirthdayPlanningRun(input.timezone, input.now),
        })
        .returning();

      if (!row) throw new Error("Failed to create birthday gift planning schedule.");
      return rowToSchedule(row);
    },
    async claimDueSchedule(input) {
      const [row] = await getDb()
        .update(birthdayGiftPlanningSchedules)
        .set({
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
          attempts: sql`${birthdayGiftPlanningSchedules.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(birthdayGiftPlanningSchedules.ownerUserId, input.ownerUserId),
            eq(birthdayGiftPlanningSchedules.enabled, true),
            lte(birthdayGiftPlanningSchedules.nextRunAt, input.now),
            or(
              isNull(birthdayGiftPlanningSchedules.leaseExpiresAt),
              lte(birthdayGiftPlanningSchedules.leaseExpiresAt, input.now),
            ),
          ),
        )
        .returning();

      return row ? rowToSchedule(row) : null;
    },
    async completeSchedule(input) {
      const [row] = await getDb()
        .update(birthdayGiftPlanningSchedules)
        .set({
          nextRunAt: input.nextRunAt,
          leaseExpiresAt: null,
          attempts: 0,
          lastError: null,
          lastRunAt: input.ranAt,
          updatedAt: input.ranAt,
        })
        .where(eq(birthdayGiftPlanningSchedules.id, input.id))
        .returning();

      if (!row) throw new Error("Birthday gift planning schedule not found.");
      return rowToSchedule(row);
    },
    async releaseSchedule(input) {
      const [row] = await getDb()
        .update(birthdayGiftPlanningSchedules)
        .set({
          leaseExpiresAt: null,
          lastError: input.lastError,
          ...(input.nextRunAt ? { nextRunAt: input.nextRunAt, attempts: 0 } : {}),
        })
        .where(eq(birthdayGiftPlanningSchedules.id, input.id))
        .returning();

      if (!row) throw new Error("Birthday gift planning schedule not found.");
      return rowToSchedule(row);
    },
  };
}

const defaultDeliveryService = createScheduledWorkflowDeliveryService(
  createDrizzleScheduledWorkflowDeliveryStore(),
);
const defaultBirthdayGiftPlanningWorkflow = createBirthdayGiftPlanningWorkflow({
  getRelationshipAgenda: (input) => getRelationshipAgenda(input),
  proposeDraft: (input) => proposeDraft(input),
  store: createDrizzleBirthdayGiftPlanningStore(),
  deliverDiscordScheduledArtifact: (input) =>
    defaultDeliveryService.deliverDiscordScheduledArtifact(input),
});

export function generateBirthdayGiftPlanning(input: GenerateBirthdayGiftPlanningInput) {
  return defaultBirthdayGiftPlanningWorkflow.generateBirthdayGiftPlanning(input);
}

export type DispatchBirthdayGiftPlanningInput = {
  ownerUserId: string;
  now?: Date;
  timezone?: string;
  discordSender?: DiscordProactiveDeliverySender;
};

export async function dispatchBirthdayGiftPlanning(input: DispatchBirthdayGiftPlanningInput) {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? "UTC";
  const store = createDrizzleBirthdayGiftPlanningStore();
  await store.ensureSchedule({ ownerUserId: input.ownerUserId, timezone, now });
  const schedule = await store.claimDueSchedule({
    ownerUserId: input.ownerUserId,
    now,
    leaseMs: DEFAULT_LEASE_MS,
  });

  if (!schedule) return null;

  try {
    const result = await generateBirthdayGiftPlanning({
      ownerUserId: schedule.ownerUserId,
      localDate: formatLocalDate(schedule.timezone, schedule.nextRunAt),
      now,
      ...(input.discordSender
        ? {
            deliverDiscord: true,
            sender: input.discordSender,
          }
        : {}),
    });
    await store.completeSchedule({
      id: schedule.id,
      nextRunAt: computeNextBirthdayPlanningRun(schedule.timezone, now),
      ranAt: now,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const giveUp = schedule.attempts >= DEFAULT_MAX_ATTEMPTS;
    await store.releaseSchedule({
      id: schedule.id,
      lastError: message,
      ...(giveUp ? { nextRunAt: computeNextBirthdayPlanningRun(schedule.timezone, now) } : {}),
    });
    throw error;
  }
}

function computeNextBirthdayPlanningRun(timezone: string, from: Date): Date {
  return computeNextBriefRun(
    {
      cadence: "daily",
      timezone,
      runAtMinute: DEFAULT_RUN_AT_MINUTE,
      weekday: null,
    },
    from,
  );
}
