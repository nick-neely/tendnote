import type {
  CalendarSuggestedFollowup,
  ScheduledWorkflowDeliveryArtifact,
} from "@tendnote/domain";
import { aggregateArtifactScope } from "@tendnote/domain";
import type { CalendarReaderForOwner } from "./calendar";
import {
  listCalendarSuggestedFollowups,
  runCalendarSuggestionWorkflow,
} from "./calendar-followups";
import {
  createDrizzleScheduledWorkflowDeliveryStore,
  createScheduledWorkflowDeliveryService,
  type DiscordProactiveDeliverySender,
  type DiscordScheduledArtifactDeliveryResult,
} from "./scheduled-workflow-deliveries";

export type { DiscordProactiveDeliverySender };

export type GeneratePostMeetingAftercareInput = {
  ownerUserId: string;
  now?: Date;
  calendarReaderFor?: CalendarReaderForOwner;
  deliverDiscord?: boolean;
  sender?: DiscordProactiveDeliverySender;
};

export type PostMeetingAftercareWorkflowResult = {
  connected: boolean;
  generated: number;
  suggestedFollowups: CalendarSuggestedFollowup[];
  memoryReviewPrompts: [];
  draftProposals: [];
  artifact: ScheduledWorkflowDeliveryArtifact | null;
  delivery: DiscordScheduledArtifactDeliveryResult | null;
  error: string | null;
};

export type PostMeetingAftercareWorkflowDeps = {
  runCalendarSuggestionWorkflow: (input: {
    ownerUserId: string;
    now?: Date;
    calendarReaderFor?: CalendarReaderForOwner;
  }) => Promise<{ connected: boolean; generated: number }>;
  listCalendarSuggestedFollowups: (ownerUserId: string) => Promise<CalendarSuggestedFollowup[]>;
  deliverDiscordScheduledArtifact?: (input: {
    artifact: ScheduledWorkflowDeliveryArtifact;
    sender: DiscordProactiveDeliverySender;
  }) => Promise<DiscordScheduledArtifactDeliveryResult>;
};

export function createPostMeetingAftercareWorkflow(deps: PostMeetingAftercareWorkflowDeps) {
  return {
    async generatePostMeetingAftercare(
      input: GeneratePostMeetingAftercareInput,
    ): Promise<PostMeetingAftercareWorkflowResult> {
      const existingSuggestions = await deps.listCalendarSuggestedFollowups(input.ownerUserId);
      const existingSuggestionIds = new Set(existingSuggestions.map((suggestion) => suggestion.id));
      const result = await runCalendarSuggestionsSafely(deps, input);

      const currentSuggestions = await deps.listCalendarSuggestedFollowups(input.ownerUserId);
      const newlyCreatedSuggestions = currentSuggestions.filter(
        (suggestion) => !existingSuggestionIds.has(suggestion.id),
      );
      const artifact =
        newlyCreatedSuggestions.length > 0
          ? toPostMeetingAftercareArtifact(newlyCreatedSuggestions)
          : null;
      const delivery =
        artifact &&
        input.deliverDiscord === true &&
        input.sender &&
        deps.deliverDiscordScheduledArtifact
          ? await deps.deliverDiscordScheduledArtifact({ artifact, sender: input.sender })
          : null;

      return {
        connected: result.connected,
        generated: result.generated,
        suggestedFollowups: newlyCreatedSuggestions,
        memoryReviewPrompts: [],
        draftProposals: [],
        artifact,
        delivery,
        error: result.error,
      };
    },
  };
}

async function runCalendarSuggestionsSafely(
  deps: PostMeetingAftercareWorkflowDeps,
  input: GeneratePostMeetingAftercareInput,
): Promise<{ connected: boolean; generated: number; error: string | null }> {
  try {
    const result = await deps.runCalendarSuggestionWorkflow({
      ownerUserId: input.ownerUserId,
      now: input.now,
      calendarReaderFor: input.calendarReaderFor,
    });
    return { ...result, error: null };
  } catch (error) {
    return {
      connected: false,
      generated: 0,
      error: scrubAftercareError(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function toPostMeetingAftercareArtifact(
  suggestions: readonly CalendarSuggestedFollowup[],
): ScheduledWorkflowDeliveryArtifact {
  const first = suggestions[0];
  if (!first) {
    throw new Error("Post-meeting aftercare artifacts require at least one persisted suggestion.");
  }

  // Calendar-derived suggestions are the owner's own meeting aftercare drawn from
  // their private calendar (Phase 2C); they carry no household visibility, so the
  // artifact fails closed to `private` (ADR-0142).
  const { scope, householdId } = aggregateArtifactScope(
    suggestions.map(() => ({ scope: "private" as const })),
  );
  return {
    ownerUserId: first.ownerUserId,
    workflow: "post_meeting_aftercare",
    artifactKind: "post_meeting_aftercare",
    artifactId: postMeetingAftercareArtifactId(suggestions),
    sensitivity: "normal",
    scope,
    householdId,
    persisted: true,
    summary: postMeetingAftercareSummary(suggestions.length),
  };
}

function postMeetingAftercareArtifactId(suggestions: readonly CalendarSuggestedFollowup[]): string {
  return `calendar-suggested-followups:${suggestions
    .map((suggestion) => suggestion.id)
    .sort()
    .join(",")}`;
}

function postMeetingAftercareSummary(suggestionCount: number): string {
  if (suggestionCount === 1) {
    return "One post-meeting aftercare proposal is ready.";
  }
  return `${suggestionCount} post-meeting aftercare proposals are ready.`;
}

function scrubAftercareError(error: string): string {
  return error.replace(/\s+/g, " ").trim().slice(0, 500);
}

const defaultDeliveryService = createScheduledWorkflowDeliveryService(
  createDrizzleScheduledWorkflowDeliveryStore(),
);

const defaultPostMeetingAftercareWorkflow = createPostMeetingAftercareWorkflow({
  runCalendarSuggestionWorkflow: (input) => runCalendarSuggestionWorkflow(input),
  listCalendarSuggestedFollowups: (ownerUserId) => listCalendarSuggestedFollowups(ownerUserId),
  deliverDiscordScheduledArtifact: (input) =>
    defaultDeliveryService.deliverDiscordScheduledArtifact(input),
});

export function generatePostMeetingAftercare(input: GeneratePostMeetingAftercareInput) {
  return defaultPostMeetingAftercareWorkflow.generatePostMeetingAftercare(input);
}

export type DispatchPostMeetingAftercareInput = {
  ownerUserId: string;
  now?: Date;
  calendarReaderFor?: CalendarReaderForOwner;
  discordSender?: DiscordProactiveDeliverySender;
};

export function dispatchPostMeetingAftercare(input: DispatchPostMeetingAftercareInput) {
  return generatePostMeetingAftercare({
    ownerUserId: input.ownerUserId,
    now: input.now,
    calendarReaderFor: input.calendarReaderFor,
    ...(input.discordSender
      ? {
          deliverDiscord: true,
          sender: input.discordSender,
        }
      : {}),
  });
}
