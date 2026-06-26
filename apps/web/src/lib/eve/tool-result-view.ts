import { z } from "zod";

/** One Eve tool result surfaced during a turn (a persisted tool's output). */
export type EveToolResult = {
  readonly toolName: string;
  readonly output: unknown;
};

/**
 * Renderable, refresh-stable view of one persisted Eve tool result. Each kind
 * references persisted ids (ADR 0028) so the web chat can show what Eve saved,
 * found, or flagged for review without treating the conversation as the source
 * of truth (ADR 0029). Malformed or unknown output degrades to `generic` so the
 * UI never invents a confirmed fact from an unrecognized payload.
 */
export type AssistantToolView =
  | {
      kind: "saved_source_record";
      sourceRecordId: string;
      content: string;
      linkedPersonId: string | null;
    }
  | {
      kind: "saved_memory";
      memoryId: string;
      sourceRecordId: string | null;
      personId: string | null;
      personName: string | null;
      content: string;
    }
  | { kind: "added_person"; personId: string; displayName: string; relationshipType: string | null }
  | {
      kind: "person_context";
      personId: string;
      personName: string | null;
      snapshotStatus: string;
      approvedCount: number;
      loggedCount: number;
      suggestedCount: number;
    }
  | {
      kind: "suggested_memory_review";
      memoryId: string;
      content: string;
      sourceRecordId: string | null;
    }
  | { kind: "generic"; toolName: string };

const sourceRecordOutput = z.object({
  sourceRecord: z.object({ id: z.string(), content: z.string() }),
  linkedPersonId: z.string().nullish(),
});

const memoryOutput = z.object({
  memory: z.object({ id: z.string(), content: z.string(), sourceRecordId: z.string().nullish() }),
  person: z.object({ id: z.string(), displayName: z.string() }).nullish(),
});

const personOutput = z.object({
  person: z.object({
    id: z.string(),
    displayName: z.string(),
    relationshipType: z.string().nullish(),
  }),
});

const personContextOutput = z.object({
  found: z.literal(true),
  person: z.object({ id: z.string(), displayName: z.string() }),
  snapshotStatus: z.string(),
  approvedMemories: z.array(z.unknown()),
  sourceRecords: z.array(z.unknown()),
  suggestedMemories: z.array(z.unknown()),
});

const suggestedMemoryOutput = z.object({
  found: z.literal(true),
  memory: z.object({ id: z.string(), content: z.string(), sourceRecordId: z.string().nullish() }),
});

/**
 * Stable React key for a rendered view, derived from the persisted record it
 * references so a list of results keys on real ids rather than array position.
 */
export function assistantToolViewKey(view: AssistantToolView): string {
  switch (view.kind) {
    case "saved_source_record":
      return `source:${view.sourceRecordId}`;
    case "saved_memory":
      return `memory:${view.memoryId}`;
    case "added_person":
      return `person:${view.personId}`;
    case "person_context":
      return `context:${view.personId}`;
    case "suggested_memory_review":
      return `suggested:${view.memoryId}`;
    default:
      return `tool:${view.toolName}`;
  }
}

/**
 * Maps one persisted Eve tool result into a renderable view, keyed on the tool
 * that produced it. Parsing is total: any shape that does not match the expected
 * persisted records falls back to `generic`.
 */
export function toAssistantToolView(toolResult: EveToolResult): AssistantToolView {
  const { toolName, output } = toolResult;

  switch (toolName) {
    case "capture_source_record": {
      const parsed = sourceRecordOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "saved_source_record",
        sourceRecordId: parsed.data.sourceRecord.id,
        content: parsed.data.sourceRecord.content,
        linkedPersonId: parsed.data.linkedPersonId ?? null,
      };
    }
    case "capture_memory": {
      const parsed = memoryOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "saved_memory",
        memoryId: parsed.data.memory.id,
        sourceRecordId: parsed.data.memory.sourceRecordId ?? null,
        personId: parsed.data.person?.id ?? null,
        personName: parsed.data.person?.displayName ?? null,
        content: parsed.data.memory.content,
      };
    }
    case "create_person": {
      const parsed = personOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "added_person",
        personId: parsed.data.person.id,
        displayName: parsed.data.person.displayName,
        relationshipType: parsed.data.person.relationshipType ?? null,
      };
    }
    case "get_person_context": {
      const parsed = personContextOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "person_context",
        personId: parsed.data.person.id,
        personName: parsed.data.person.displayName,
        snapshotStatus: parsed.data.snapshotStatus,
        approvedCount: parsed.data.approvedMemories.length,
        loggedCount: parsed.data.sourceRecords.length,
        suggestedCount: parsed.data.suggestedMemories.length,
      };
    }
    case "get_suggested_memory_review": {
      const parsed = suggestedMemoryOutput.safeParse(output);
      if (!parsed.success) break;
      return {
        kind: "suggested_memory_review",
        memoryId: parsed.data.memory.id,
        content: parsed.data.memory.content,
        sourceRecordId: parsed.data.memory.sourceRecordId ?? null,
      };
    }
    default:
      break;
  }

  return { kind: "generic", toolName };
}
