import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BriefItemKind, Sensitivity } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createBriefGenerator } from "./briefs/generator";
import { createInMemoryBriefStore } from "./briefs/in-memory-store";
import { createMorningAgendaWorkflow } from "./morning-agenda";
import type { RelationshipAgendaCandidate } from "./relationship-agenda";
import {
  createInMemoryScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
} from "./scheduled-workflow-deliveries";

const OWNER = "owner-1";
const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const FOLLOWUP_ID = "22222222-2222-2222-2222-222222222222";
const SOURCE_RECORD_ID = "33333333-3333-3333-3333-333333333333";
const MEMORY_ID = "44444444-4444-4444-4444-444444444444";
const NOW = new Date("2026-07-02T08:00:00.000Z");

function candidate(
  kind: BriefItemKind,
  overrides: Partial<RelationshipAgendaCandidate> = {},
): RelationshipAgendaCandidate {
  return {
    kind: kind as RelationshipAgendaCandidate["kind"],
    personId: PERSON_ID,
    personDisplayName: "Alex",
    title: `${kind} for Alex`,
    reason: `Grounded ${kind} reason.`,
    dueAt: new Date("2026-07-02T12:00:00.000Z"),
    sourceRefs: [{ kind: "source_record", id: SOURCE_RECORD_ID }],
    trustLevel: kind === "due_followup" ? "active_reminder" : "logged_context",
    sensitivity: "normal",
    rank: 1,
    ...overrides,
  };
}

function setupIntegratedWorkflow(
  input: { candidates?: RelationshipAgendaCandidate[]; calendarSensitivity?: Sensitivity } = {},
) {
  const store = createInMemoryBriefStore();
  const agenda = {
    getRelationshipAgenda: vi.fn(
      async () =>
        input.candidates ?? [
          candidate("due_followup", {
            sourceRefs: [{ kind: "followup", id: FOLLOWUP_ID }],
            trustLevel: "active_reminder",
          }),
          candidate("birthday", {
            title: "Alex has a birthday",
            sourceRefs: [{ kind: "person", id: PERSON_ID }],
            trustLevel: "stored_profile_data",
          }),
          candidate("review_item", {
            title: "Review Alex note",
            sourceRefs: [{ kind: "memory", id: MEMORY_ID }],
            trustLevel: "tentative",
            sensitivity: "sensitive",
          }),
          candidate("recent_context", {
            title: "Hidden restricted context",
            sensitivity: "restricted",
          }),
        ],
    ),
  };
  const calendarContext = vi.fn(async () => [
    {
      title: "Coffee with Alex",
      reason: "Upcoming Calendar event with Alex.",
      start: new Date("2026-07-02T16:00:00.000Z"),
      allDay: false,
    },
  ]);
  const generator = createBriefGenerator(store, agenda, { calendarContext });
  const generateBrief = (generationInput: Parameters<typeof generator.generateBrief>[0]) =>
    generator.generateBrief(generationInput);
  const workflow = createMorningAgendaWorkflow({ generateBrief });

  return { agenda, calendarContext, store, workflow, generateBrief };
}

describe("Morning Agenda workflow", () => {
  it("persists a small grounded daily agenda from eligible private context", async () => {
    const { agenda, calendarContext, workflow } = setupIntegratedWorkflow();

    const result = await workflow.generateMorningAgenda({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });

    expect(result.brief.cadence).toBe("daily");
    expect(result.brief.items.map((item) => item.kind)).toEqual([
      "due_followup",
      "birthday",
      "review_item",
      "calendar_event",
    ]);
    expect(result.brief.items).toHaveLength(4);
    expect(result.brief.items.some((item) => item.sensitivity === "restricted")).toBe(false);
    expect(result.artifact).toMatchObject({
      ownerUserId: OWNER,
      workflow: "morning_agenda",
      artifactKind: "morning_agenda",
      artifactId: result.brief.id,
      persisted: true,
      sensitivity: "sensitive",
    });
    expect(agenda.getRelationshipAgenda).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: OWNER,
        includeKinds: ["due_followup", "birthday", "suggested_followup", "review_item"],
      }),
    );
    expect(calendarContext).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: OWNER, limit: 2 }),
    );
  });

  it("is idempotent for the same owner, local date, and daily cadence", async () => {
    const { workflow, store } = setupIntegratedWorkflow();

    const first = await workflow.generateMorningAgenda({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
    });
    const second = await workflow.generateMorningAgenda({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: new Date("2026-07-02T09:00:00.000Z"),
    });

    expect(second.brief.id).toBe(first.brief.id);
    await expect(store.listBriefsForOwner({ ownerUserId: OWNER })).resolves.toHaveLength(1);
  });

  it("attempts opt-in Discord delivery only after a persisted artifact exists", async () => {
    const { generateBrief, store } = setupIntegratedWorkflow({
      candidates: [
        candidate("due_followup", {
          sourceRefs: [{ kind: "followup", id: FOLLOWUP_ID }],
          trustLevel: "active_reminder",
        }),
      ],
    });
    const delivery = createScheduledWorkflowDeliveryService(
      createInMemoryScheduledWorkflowDeliveryStore(),
    );
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-morning",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => undefined);
    const workflow = createMorningAgendaWorkflow({
      generateBrief,
      deliverDiscordScheduledArtifact: (input) => delivery.deliverDiscordScheduledArtifact(input),
    });

    const result = await workflow.generateMorningAgenda({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      now: NOW,
      deliverDiscord: true,
      sender,
    });

    await expect(store.getBrief({ ownerUserId: OWNER, briefId: result.brief.id })).resolves.toEqual(
      result.brief,
    );
    expect(result.delivery).toMatchObject({
      type: "sent",
      attempt: { artifactId: result.brief.id, artifactKind: "morning_agenda", status: "sent" },
    });
    expect(sender).toHaveBeenCalledWith({
      targetId: "discord-morning",
      content: "Tendnote morning agenda is ready for review: 2 relationship prompts are ready.",
    });
  });

  it("keeps the in-app artifact reviewable when Discord delivery is not configured", async () => {
    const { generateBrief, store } = setupIntegratedWorkflow({
      candidates: [
        candidate("due_followup", {
          sourceRefs: [{ kind: "followup", id: FOLLOWUP_ID }],
          trustLevel: "active_reminder",
        }),
      ],
    });
    const delivery = createScheduledWorkflowDeliveryService(
      createInMemoryScheduledWorkflowDeliveryStore(),
    );
    const sender = vi.fn(async () => undefined);
    const workflow = createMorningAgendaWorkflow({
      generateBrief,
      deliverDiscordScheduledArtifact: (input) => delivery.deliverDiscordScheduledArtifact(input),
    });

    const result = await workflow.generateMorningAgenda({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      deliverDiscord: true,
      sender,
    });

    await expect(store.getBrief({ ownerUserId: OWNER, briefId: result.brief.id })).resolves.toEqual(
      result.brief,
    );
    expect(result.delivery).toMatchObject({
      type: "skipped",
      reason: "missing_discord_target",
      attempt: { artifactId: result.brief.id, status: "skipped" },
    });
    expect(sender).not.toHaveBeenCalled();
  });

  it("keeps the in-app artifact reviewable when Discord delivery fails", async () => {
    const { generateBrief, store } = setupIntegratedWorkflow({
      candidates: [
        candidate("due_followup", {
          sourceRefs: [{ kind: "followup", id: FOLLOWUP_ID }],
          trustLevel: "active_reminder",
        }),
      ],
    });
    const delivery = createScheduledWorkflowDeliveryService(
      createInMemoryScheduledWorkflowDeliveryStore(),
    );
    await delivery.configureDiscordWorkflowDelivery({
      ownerUserId: OWNER,
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-morning",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => {
      throw new Error("Discord unavailable");
    });
    const workflow = createMorningAgendaWorkflow({
      generateBrief,
      deliverDiscordScheduledArtifact: (input) => delivery.deliverDiscordScheduledArtifact(input),
    });

    const result = await workflow.generateMorningAgenda({
      ownerUserId: OWNER,
      localDate: "2026-07-02",
      deliverDiscord: true,
      sender,
    });

    await expect(store.getBrief({ ownerUserId: OWNER, briefId: result.brief.id })).resolves.toEqual(
      result.brief,
    );
    expect(result.delivery).toMatchObject({
      type: "failed",
      error: "Discord unavailable",
      attempt: { artifactId: result.brief.id, status: "failed" },
    });
  });

  it("does not import autonomous follow-up, memory, source-record, draft, or external-send mutations", () => {
    const source = readFileSync(join(process.cwd(), "src/queries/morning-agenda.ts"), "utf8");
    const importSources = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

    for (const moduleId of importSources) {
      expect(moduleId).not.toMatch(/queries\/(followups|memories|source-records|drafts|gmail)/);
      expect(moduleId).not.toMatch(/sendgrid|twilio|slack|resend|nodemailer/i);
    }
  });
});
