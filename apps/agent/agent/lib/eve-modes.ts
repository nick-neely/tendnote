export type EveMode =
  | "discord_capture"
  | "selected_person"
  | "drafting"
  | "scheduled_workflow"
  | "cleanup_preview";

export type EveCaller = "web" | "discord" | "schedule" | "sandbox";
export type EveChannel = "web" | "discord" | "schedule" | "sandbox";

export type Phase3Workflow =
  | "morning_agenda"
  | "post_meeting_aftercare"
  | "weekly_relationship_review"
  | "birthday_gift_planning"
  | "cleanup_preview";

export type EveModeContext = {
  caller: EveCaller;
  channel: EveChannel;
  selectedPersonId?: string;
  workflow?: Phase3Workflow;
  requestedTask?: "capture" | "draft" | "memory_cleanup" | "strategy" | "cleanup_preview";
};

export type EveCapability =
  | "capture_source_record"
  | "review_suggestions"
  | "person_scoped_recall"
  | "propose_followup"
  | "draft_proposal"
  | "persist_draft_with_intent"
  | "memory_cleanup_proposal"
  | "scheduled_artifact_proposal"
  | "cleanup_preview"
  | "sandbox_parse";

export type EveToolName =
  | "capture_source_record"
  | "list_suggested_memory_reviews"
  | "get_suggested_memory_review"
  | "approve_suggested_memory"
  | "dismiss_suggested_memory"
  | "search_people"
  | "get_person_context"
  | "search_relationship_context"
  | "search_semantic_context"
  | "get_relationship_agenda"
  | "list_due_followups"
  | "list_calendar_events"
  | "list_suggested_followup_reviews"
  | "propose_followup"
  | "create_message_draft";

export type EveSkillName =
  | "capturing-and-review"
  | "recall"
  | "followups"
  | "drafting"
  | "memory-cleanup"
  | "follow-up-strategy"
  | "meeting-prep"
  | "gift-planning"
  | "birthday-messages"
  | "relationship-repair"
  | "cleanup-preview";

type EveModeDefinition = {
  mode: EveMode;
  tools: readonly EveToolName[];
  skills: readonly EveSkillName[];
  capabilities: readonly EveCapability[];
};

const modeDefinitions = {
  discord_capture: {
    mode: "discord_capture",
    tools: [
      "capture_source_record",
      "list_suggested_memory_reviews",
      "get_suggested_memory_review",
      "dismiss_suggested_memory",
      "search_people",
    ],
    skills: ["capturing-and-review"],
    capabilities: ["capture_source_record", "review_suggestions"],
  },
  selected_person: {
    mode: "selected_person",
    tools: [
      "search_people",
      "get_person_context",
      "search_relationship_context",
      "search_semantic_context",
      "list_due_followups",
      "propose_followup",
      "create_message_draft",
      "list_suggested_memory_reviews",
      "get_suggested_memory_review",
    ],
    skills: [
      "recall",
      "followups",
      "drafting",
      "memory-cleanup",
      "follow-up-strategy",
      "relationship-repair",
    ],
    capabilities: [
      "person_scoped_recall",
      "propose_followup",
      "draft_proposal",
      "persist_draft_with_intent",
      "memory_cleanup_proposal",
      "review_suggestions",
    ],
  },
  drafting: {
    mode: "drafting",
    tools: [
      "search_people",
      "get_person_context",
      "search_relationship_context",
      "search_semantic_context",
      "create_message_draft",
    ],
    skills: ["drafting", "birthday-messages", "relationship-repair"],
    capabilities: ["person_scoped_recall", "draft_proposal", "persist_draft_with_intent"],
  },
  scheduled_workflow: {
    mode: "scheduled_workflow",
    tools: [
      "get_relationship_agenda",
      "list_due_followups",
      "list_calendar_events",
      "list_suggested_followup_reviews",
      "list_suggested_memory_reviews",
      "propose_followup",
    ],
    skills: ["meeting-prep", "gift-planning", "follow-up-strategy", "memory-cleanup"],
    capabilities: ["scheduled_artifact_proposal", "propose_followup", "review_suggestions"],
  },
  cleanup_preview: {
    mode: "cleanup_preview",
    tools: [],
    skills: ["cleanup-preview"],
    capabilities: ["cleanup_preview", "sandbox_parse"],
  },
} satisfies Record<EveMode, EveModeDefinition>;

export function resolveEveMode(context: EveModeContext): EveModeDefinition {
  if (context.workflow === "cleanup_preview" || context.requestedTask === "cleanup_preview") {
    return modeDefinitions.cleanup_preview;
  }

  if (context.caller === "schedule" || context.channel === "schedule" || context.workflow) {
    return modeDefinitions.scheduled_workflow;
  }

  if (context.caller === "discord" || context.channel === "discord") {
    return modeDefinitions.discord_capture;
  }

  if (context.requestedTask === "draft") {
    return modeDefinitions.drafting;
  }

  if (context.selectedPersonId) {
    return modeDefinitions.selected_person;
  }

  return modeDefinitions.selected_person;
}

export function modeAllowsTool(mode: EveMode, tool: EveToolName): boolean {
  const definition: EveModeDefinition = modeDefinitions[mode];
  return definition.tools.includes(tool);
}

export function modeAllowsCapability(mode: EveMode, capability: EveCapability): boolean {
  const definition: EveModeDefinition = modeDefinitions[mode];
  return definition.capabilities.includes(capability);
}

export function listEveModeDefinitions(): EveModeDefinition[] {
  return Object.values(modeDefinitions) as EveModeDefinition[];
}
