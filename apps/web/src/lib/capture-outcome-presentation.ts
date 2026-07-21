import type { ConversationalCaptureOutcomeConfirmation } from "@tendnote/domain";

export function captureOutcomePresentation(outcome: ConversationalCaptureOutcomeConfirmation): {
  key: string;
  description: string;
  visibility: string;
  dueAt: string | null;
  cadence: string | null;
} {
  switch (outcome.destination) {
    case "Saved Items":
      return {
        key: `${outcome.change.kind}:${outcome.change.savedItemId}`,
        description: outcome.interpreted.kind,
        visibility: outcome.interpreted.visibility,
        dueAt: null,
        cadence: null,
      };
    case "Actions":
    case "Routines":
      return {
        key: `${outcome.change.kind}:${outcome.change.generalActionId}`,
        description: outcome.interpreted.title,
        visibility: outcome.interpreted.scope,
        dueAt: outcome.interpreted.dueAt,
        cadence: outcome.interpreted.cadence,
      };
    case "Follow-Ups":
      return {
        key: `${outcome.change.kind}:${outcome.change.followupId}`,
        description: `Follow-Up with ${outcome.interpreted.person}`,
        visibility: outcome.interpreted.scope,
        dueAt: outcome.interpreted.dueAt,
        cadence: null,
      };
    case "People":
      return {
        key: `${outcome.change.kind}:${outcome.change.personId}`,
        description: outcome.interpreted.displayName,
        visibility: outcome.interpreted.scope,
        dueAt: null,
        cadence: null,
      };
    case "Memories":
      return {
        key: `${outcome.change.kind}:${outcome.change.memoryId}`,
        description: `Approved Memory for ${outcome.interpreted.person}`,
        visibility: outcome.interpreted.scope,
        dueAt: null,
        cadence: null,
      };
    case "Review": {
      const key =
        outcome.change.kind === "edit_memory"
          ? `${outcome.change.kind}:${outcome.change.memoryId}`
          : `${outcome.change.kind}:${outcome.change.groupId}`;
      return {
        key,
        description: `${outcome.interpreted.name} · Needs review`,
        visibility: outcome.interpreted.scope,
        dueAt: null,
        cadence: null,
      };
    }
  }
}
