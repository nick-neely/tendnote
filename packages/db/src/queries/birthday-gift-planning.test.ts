import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DraftProposalResult } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  type BirthdayGiftPlanningArtifact,
  type BirthdayGiftPlanningSchedule,
  type BirthdayGiftPlanningStore,
  createBirthdayGiftPlanningWorkflow,
} from "./birthday-gift-planning";
import type { RelationshipAgendaCandidate } from "./relationship-agenda";
import {
  createInMemoryScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
} from "./scheduled-workflow-deliveries";

const OWNER = "owner-1";
const PERSON_ID = "person-1";
const NOW = new Date("2026-07-02T09:00:00.000Z");

function birthdayCandidate(
  overrides: Partial<RelationshipAgendaCandidate> = {},
): RelationshipAgendaCandidate {
  return {
    kind: "birthday",
    personId: PERSON_ID,
    personDisplayName: "Maya",
    title: "Upcoming birthday for Maya",
    reason: "Birthday is inside the planning window.",
    dueAt: new Date("2026-07-20T00:00:00.000Z"),
    sourceRefs: [
      { kind: "person", id: PERSON_ID },
      { kind: "memory", id: "memory-1" },
    ],
    trustLevel: "stored_profile_data",
    sensitivity: "normal",
    rank: 1,
    ...overrides,
  };
}

function draftProposal(): DraftProposalResult {
  return {
    ownerUserId: OWNER,
    proposal: {
      id: "draft-proposal-1",
      ownerUserId: OWNER,
      personId: PERSON_ID,
      personDisplayName: "Maya",
      channel: "text",
      purpose: "birthday",
      variants: [
        { id: "variant-1", label: "Warm", toneInstruction: "warm", body: "Happy birthday!" },
      ],
      sourceRefs: [{ kind: "brief_item", id: PERSON_ID, label: "Birthday", trust: "entry_point" }],
      ephemeral: true,
      persistenceRequiresExplicitOwnerIntent: true,
    },
    skippedReason: null,
    component: { type: "draft_proposal", proposalId: "draft-proposal-1" },
  };
}

function memoryStore(seed: BirthdayGiftPlanningArtifact[] = []): BirthdayGiftPlanningStore {
  const rows = new Map(seed.map((row) => [`${row.ownerUserId}:${row.localDate}`, row]));
  const schedules = new Map<string, BirthdayGiftPlanningSchedule>();
  return {
    async findArtifact(input) {
      return rows.get(`${input.ownerUserId}:${input.localDate}`) ?? null;
    },
    async findArtifactForBirthdayKey(input) {
      return (
        [...rows.values()].find(
          (row) =>
            row.ownerUserId === input.ownerUserId && row.birthdayKeys.includes(input.birthdayKey),
        ) ?? null
      );
    },
    async createArtifact(input) {
      const now = new Date("2026-07-02T09:00:00.000Z");
      const row: BirthdayGiftPlanningArtifact = {
        id: `artifact-${rows.size + 1}`,
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      rows.set(`${row.ownerUserId}:${row.localDate}`, row);
      return row;
    },
    async ensureSchedule(input) {
      const existing = schedules.get(input.ownerUserId);
      if (existing) return existing;
      const schedule: BirthdayGiftPlanningSchedule = {
        id: `schedule-${schedules.size + 1}`,
        ownerUserId: input.ownerUserId,
        timezone: input.timezone,
        runAtMinute: 540,
        nextRunAt: input.now,
        enabled: true,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        lastRunAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      };
      schedules.set(input.ownerUserId, schedule);
      return schedule;
    },
    async claimDueSchedule(input) {
      const schedule = schedules.get(input.ownerUserId);
      if (
        !schedule?.enabled ||
        schedule.nextRunAt.getTime() > input.now.getTime() ||
        (schedule.leaseExpiresAt && schedule.leaseExpiresAt.getTime() > input.now.getTime())
      ) {
        return null;
      }
      const claimed = {
        ...schedule,
        attempts: schedule.attempts + 1,
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
        updatedAt: input.now,
      };
      schedules.set(input.ownerUserId, claimed);
      return claimed;
    },
    async completeSchedule(input) {
      const schedule = [...schedules.values()].find((row) => row.id === input.id);
      if (!schedule) throw new Error("Birthday gift planning schedule not found.");
      const completed = {
        ...schedule,
        nextRunAt: input.nextRunAt,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        lastRunAt: input.ranAt,
        updatedAt: input.ranAt,
      };
      schedules.set(completed.ownerUserId, completed);
      return completed;
    },
    async releaseSchedule(input) {
      const schedule = [...schedules.values()].find((row) => row.id === input.id);
      if (!schedule) throw new Error("Birthday gift planning schedule not found.");
      const released = {
        ...schedule,
        leaseExpiresAt: null,
        lastError: input.lastError,
        ...(input.nextRunAt ? { nextRunAt: input.nextRunAt, attempts: 0 } : {}),
      };
      schedules.set(released.ownerUserId, released);
      return released;
    },
  };
}

function setupWorkflow(
  input: {
    candidates?: RelationshipAgendaCandidate[];
    store?: BirthdayGiftPlanningStore;
    deliverDiscord?: boolean;
  } = {},
) {
  const delivery = createScheduledWorkflowDeliveryService(
    createInMemoryScheduledWorkflowDeliveryStore(),
  );
  const getRelationshipAgenda = vi.fn(async () => input.candidates ?? [birthdayCandidate()]);
  const proposeDraft = vi.fn(async () => draftProposal());
  const workflow = createBirthdayGiftPlanningWorkflow({
    getRelationshipAgenda,
    proposeDraft,
    store: input.store ?? memoryStore(),
    deliverDiscordScheduledArtifact: input.deliverDiscord
      ? (args) => delivery.deliverDiscordScheduledArtifact(args)
      : undefined,
  });

  return { workflow, getRelationshipAgenda, proposeDraft, delivery };
}

describe("Birthday Gift Planning workflow", () => {
  it("selects upcoming birthdays early through the relationship agenda birthday seam", async () => {
    const { workflow, getRelationshipAgenda } = setupWorkflow();

    await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });

    expect(getRelationshipAgenda).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      windowStart: new Date("2026-07-02T00:00:00.000Z"),
      windowEnd: new Date("2026-08-01T00:00:00.000Z"),
      query: "birthday gift planning",
      includeKinds: ["birthday"],
      limit: 10,
    });
  });

  it("persists grounded review-only gift and draft proposals", async () => {
    const { workflow, proposeDraft } = setupWorkflow();

    const result = await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });

    expect(result.artifactRecord.proposals).toHaveLength(1);
    expect(result.artifactRecord.proposals[0]).toMatchObject({
      personId: PERSON_ID,
      personDisplayName: "Maya",
      giftIdeas: expect.arrayContaining([expect.stringContaining("Birthday is inside")]),
      draftProposal: expect.objectContaining({
        ephemeral: true,
        persistenceRequiresExplicitOwnerIntent: true,
      }),
      reviewOnly: true,
    });
    expect(result.artifactRecord.birthdayKeys).toEqual(["birthday_gift:person-1:07-20"]);
    expect(result.artifactRecord.proposals[0]?.sourceRefs).toEqual(
      expect.arrayContaining([
        { kind: "person", id: PERSON_ID },
        { kind: "memory", id: "memory-1" },
        { kind: "brief_item", id: PERSON_ID, label: "Birthday", trust: "entry_point" },
      ]),
    );
    expect(result.artifact).toMatchObject({
      workflow: "birthday_gift_planning",
      artifactKind: "birthday_gift_planning",
      artifactId: result.artifactRecord.id,
      persisted: true,
    });
    expect(proposeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: OWNER, personId: PERSON_ID, purpose: "birthday" }),
    );
  });

  it("is idempotent for the same owner and local date", async () => {
    const store = memoryStore();
    const { workflow, getRelationshipAgenda } = setupWorkflow({ store });

    const first = await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });
    const second = await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });

    expect(second.artifactRecord.id).toBe(first.artifactRecord.id);
    expect(getRelationshipAgenda).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a birthday already planned on an earlier local date in the window", async () => {
    const store = memoryStore();
    const { workflow } = setupWorkflow({ store });

    const first = await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });
    const second = await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-03",
      now: new Date("2026-07-03T09:00:00.000Z"),
    });

    expect(first.artifactRecord.proposals).toHaveLength(1);
    expect(second.artifactRecord.proposals).toHaveLength(0);
    expect(second.artifactRecord.birthdayKeys).toEqual([]);
  });

  it("skips ungrounded candidates when the drafter cannot produce a proposal", async () => {
    const getRelationshipAgenda = vi.fn(async () => [
      birthdayCandidate({ sourceRefs: [{ kind: "person", id: PERSON_ID }] }),
    ]);
    const proposeDraft = vi.fn(
      async (): Promise<DraftProposalResult> => ({
        ownerUserId: OWNER,
        proposal: null,
        skippedReason: "insufficient_context",
        component: { type: "draft_proposal", proposalId: null },
      }),
    );
    const workflow = createBirthdayGiftPlanningWorkflow({
      getRelationshipAgenda,
      proposeDraft,
      store: memoryStore(),
    });

    const result = await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });

    expect(result.artifactRecord.proposals).toEqual([]);
    expect(result.artifactRecord.summary).toBe("No birthday planning proposals are ready.");
  });

  it("filters restricted birthday candidates before persistence", async () => {
    const { workflow } = setupWorkflow({
      candidates: [
        birthdayCandidate({ sensitivity: "restricted" }),
        birthdayCandidate({
          personId: "person-2",
          personDisplayName: "Nia",
          sensitivity: "sensitive",
        }),
      ],
    });

    const result = await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });

    expect(result.artifactRecord.proposals).toHaveLength(1);
    expect(result.artifactRecord.proposals[0]?.personDisplayName).toBe("Nia");
    expect(result.artifact.sensitivity).toBe("sensitive");
  });

  it("keeps the artifact reviewable when Discord delivery fails", async () => {
    const { workflow, delivery } = setupWorkflow({ deliverDiscord: true });
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "birthday_gift_planning",
      enabled: true,
      targetId: "discord-birthday",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => {
      throw new Error("Discord unavailable");
    });

    const result = await workflow.generateBirthdayGiftPlanning({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
      deliverDiscord: true,
      sender,
    });

    expect(result.artifactRecord.proposals).toHaveLength(1);
    expect(result.delivery).toMatchObject({
      type: "failed",
      error: "Discord unavailable",
      attempt: { artifactId: result.artifactRecord.id, status: "failed" },
    });
  });

  it("does not import autonomous active reminder, persisted draft, or external-send mutations", () => {
    const source = readFileSync(
      join(process.cwd(), "src/queries/birthday-gift-planning.ts"),
      "utf8",
    );
    const importSources = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

    for (const moduleId of importSources) {
      expect(moduleId).not.toMatch(/queries\/(followups|drafts|gmail)/);
      expect(moduleId).not.toMatch(/sendgrid|twilio|slack|resend|nodemailer/i);
    }
  });
});
