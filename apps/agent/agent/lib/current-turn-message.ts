import { defineState } from "eve/context";

type CurrentTurnMessage = {
  readonly turnId: string | null;
  readonly message: string | null;
};

export const currentTurnMessage = defineState<CurrentTurnMessage>(
  "tendnote.current-turn-message",
  () => ({ turnId: null, message: null }),
);

const DELEGATED_ACTION_EDIT = [
  /\bwhichever\b/i,
  /\bwhatever\s+(?:time|date|day|action|task)\b/i,
  /\byou\s+(?:decide|think|choose|pick)\b/i,
  /\buse\s+your\s+(?:judgment|judgement|discretion)\b/i,
  /\bpick\s+(?:it|one|an?\s+action|an?\s+task)\s+for\s+me\b/i,
] as const;

export function assertCurrentTurnAuthorizesGeneralActionEdit(input: {
  readonly message: string | null;
}) {
  const message = input.message;
  if (!message) {
    throw new Error("The current user message is unavailable; the Action edit was not authorized.");
  }
  if (DELEGATED_ACTION_EDIT.some((pattern) => pattern.test(message))) {
    throw new Error(
      "The user delegated the Action or value choice; ask for one specific Action and change instead.",
    );
  }
}

export function currentAuthenticatedTurnMessage(turnId: string): string | null {
  const recorded = currentTurnMessage.get();
  return recorded.turnId === turnId ? recorded.message : null;
}
