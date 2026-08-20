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
}): { authorized: true } | { authorized: false; guidance: string } {
  const message = input.message;
  if (!message) {
    return {
      authorized: false,
      guidance: "Ask the user to name one specific Action and the exact change they want.",
    };
  }
  if (DELEGATED_ACTION_EDIT.some((pattern) => pattern.test(message))) {
    return {
      authorized: false,
      guidance:
        "The user delegated the Action or value choice. Ask for one specific Action and a user-supplied value; do not choose either for them.",
    };
  }
  return { authorized: true };
}

export function currentAuthenticatedTurnMessage(turnId: string): string | null {
  const recorded = currentTurnMessage.get();
  return recorded.turnId === turnId ? recorded.message : null;
}
