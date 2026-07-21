import {
  type ConversationalCaptureOutcomeConfirmation,
  conversationalCaptureConfirmationSchema,
} from "@tendnote/domain";

export function parseOutcomeConfirmation(input: unknown): ConversationalCaptureOutcomeConfirmation {
  const confirmation = conversationalCaptureConfirmationSchema.parse(input);
  if (confirmation.destination === "Grouped") {
    throw new Error("Expected one Capture outcome confirmation.");
  }
  return confirmation;
}
