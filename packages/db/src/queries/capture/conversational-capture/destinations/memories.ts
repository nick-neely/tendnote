import type { ConversationalCaptureInferredSuggestion } from "@tendnote/domain";
import type { CaptureDestinationInput, ResolvedCaptureRoute } from "../destinations";
import type { ConversationalCaptureDeps } from "../types";
import { parseOutcomeConfirmation } from "./confirmation";

export async function createMemoryDestination(
  input: CaptureDestinationInput<Extract<ResolvedCaptureRoute, { destination: "memory" }>>,
) {
  if (!input.resolvedPerson || !input.deps.createApprovedMemory) {
    throw new Error("Memory capture is unavailable.");
  }
  const memory = await input.deps.createApprovedMemory({
    ownerUserId: input.ownerUserId,
    personId: input.resolvedPerson.id,
    content: input.route.content,
    sourceRecordId: input.sourceRecordId,
    scope: input.visibility.scope,
    householdId: input.visibility.householdId,
    selectedUserIds: input.visibility.selectedUserIds,
  });
  const confirmation = parseOutcomeConfirmation({
    destination: "Memories",
    groundedBySourceRecordId: input.sourceRecordId,
    interpreted: {
      person: input.resolvedPerson.displayName,
      authority: "Approved",
      scope: input.visibility.label,
    },
    change: {
      kind: "edit_memory",
      memoryId: memory.id,
      sourceRecordId: input.sourceRecordId,
    },
    undo: { kind: "archive_memory", memoryId: memory.id },
  });
  return { kind: "memory" as const, memory, confirmation, id: memory.id };
}

export async function createSuggestedMemoryReview(input: {
  deps: ConversationalCaptureDeps;
  ownerUserId: string;
  sourceRecordId: string;
  suggestion: Extract<ConversationalCaptureInferredSuggestion, { kind: "memory" }>;
}) {
  if (!input.deps.createSuggestedMemory) {
    throw new Error("Suggested Memory capture is unavailable.");
  }
  const memory = await input.deps.createSuggestedMemory({
    ownerUserId: input.ownerUserId,
    personId: input.suggestion.personId,
    content: input.suggestion.content,
    sourceRecordId: input.sourceRecordId,
  });
  return {
    kind: "memory" as const,
    memory,
    id: memory.id,
    confirmation: parseOutcomeConfirmation({
      destination: "Review",
      groundedBySourceRecordId: input.sourceRecordId,
      interpreted: {
        record: "Memory",
        name: `Memory for ${input.suggestion.personName}`,
        authority: "Needs review",
        scope: "Only me",
      },
      change: {
        kind: "edit_memory",
        memoryId: memory.id,
        sourceRecordId: input.sourceRecordId,
      },
      undo: { kind: "archive_memory", memoryId: memory.id },
    }),
  };
}
