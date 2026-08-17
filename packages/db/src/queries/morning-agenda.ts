import type {
  BriefWithItems,
  ScheduledWorkflowDeliveryArtifact,
  Sensitivity,
} from "@tendnote/domain";
import { aggregateArtifactScope } from "@tendnote/domain";
import { generateBrief } from "./briefs";
import type { CalendarReaderForOwner } from "./calendar";
import {
  createDrizzleScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
  type DiscordProactiveDeliverySender,
  type DiscordScheduledArtifactDeliveryResult,
} from "./scheduled-workflow-deliveries";

export type { DiscordProactiveDeliverySender };

export type GenerateMorningAgendaInput = {
  ownerUserId: string;
  localDate: string;
  now?: Date;
  calendarReaderFor?: CalendarReaderForOwner;
  deliverDiscord?: boolean;
  sender?: DiscordProactiveDeliverySender;
};

export type MorningAgendaWorkflowResult = {
  brief: BriefWithItems;
  artifact: ScheduledWorkflowDeliveryArtifact;
  delivery: DiscordScheduledArtifactDeliveryResult | null;
};

export type MorningAgendaWorkflowDeps = {
  generateBrief: (input: {
    ownerUserId: string;
    cadence: "daily";
    localDate: string;
    generationReason: "scheduled";
    now?: Date;
    calendarReaderFor?: CalendarReaderForOwner;
  }) => Promise<BriefWithItems>;
  deliverDiscordScheduledArtifact?: (input: {
    artifact: ScheduledWorkflowDeliveryArtifact;
    sender: DiscordProactiveDeliverySender;
  }) => Promise<DiscordScheduledArtifactDeliveryResult>;
};

export function createMorningAgendaWorkflow(deps: MorningAgendaWorkflowDeps) {
  return {
    async generateMorningAgenda(
      input: GenerateMorningAgendaInput,
    ): Promise<MorningAgendaWorkflowResult> {
      const brief = await deps.generateBrief({
        ownerUserId: input.ownerUserId,
        cadence: "daily",
        localDate: input.localDate,
        generationReason: "scheduled",
        now: input.now,
        calendarReaderFor: input.calendarReaderFor,
      });
      const artifact = toMorningAgendaArtifact(brief);

      const delivery =
        input.deliverDiscord === true && input.sender && deps.deliverDiscordScheduledArtifact
          ? await deps.deliverDiscordScheduledArtifact({ artifact, sender: input.sender })
          : null;

      return { brief, artifact, delivery };
    },
  };
}

export function toMorningAgendaArtifact(brief: BriefWithItems): ScheduledWorkflowDeliveryArtifact {
  // The agenda is only as shareable as its least-shareable item: it carries a
  // household scope only when every brief item is household-visible for the same
  // household, and fails closed to `private` otherwise (ADR-0142).
  const { scope, householdId } = aggregateArtifactScope(
    brief.items.map((item) => ({ scope: item.scope, householdId: item.householdId })),
  );
  return {
    ownerUserId: brief.ownerUserId,
    workflow: "morning_agenda",
    artifactKind: "morning_agenda",
    artifactId: brief.id,
    sensitivity: maxBriefSensitivity(brief.items.map((item) => item.sensitivity)),
    scope,
    householdId,
    persisted: true,
    summary: brief.summary ?? morningAgendaFallbackSummary(brief.items.length),
  };
}

function maxBriefSensitivity(sensitivities: Sensitivity[]): Sensitivity {
  if (sensitivities.includes("restricted")) return "restricted";
  if (sensitivities.includes("sensitive")) return "sensitive";
  return "normal";
}

function morningAgendaFallbackSummary(itemCount: number): string {
  if (itemCount === 0) return "No relationship prompts are ready.";
  if (itemCount === 1) return "One relationship prompt is ready.";
  return `${itemCount} relationship prompts are ready.`;
}

const defaultDeliveryService = createScheduledWorkflowDeliveryService(
  createDrizzleScheduledWorkflowDeliveryStore(),
);

const defaultMorningAgendaWorkflow = createMorningAgendaWorkflow({
  generateBrief: (input) => generateBrief(input),
  deliverDiscordScheduledArtifact: (input) =>
    defaultDeliveryService.deliverDiscordScheduledArtifact(input),
});

export function generateMorningAgenda(input: GenerateMorningAgendaInput) {
  return defaultMorningAgendaWorkflow.generateMorningAgenda(input);
}
