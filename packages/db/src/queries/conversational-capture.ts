import { createConversationalCapture } from "./capture/conversational-capture";
import { createDrizzleSavedItemLifecycleStore } from "./saved-items/drizzle-store";

export type { ConversationalCaptureInput } from "./capture/conversational-capture";
export { createConversationalCapture } from "./capture/conversational-capture";

const defaultConversationalCapture = createConversationalCapture(
  createDrizzleSavedItemLifecycleStore(),
);

export function captureExplicitSavedItem(
  input: Parameters<typeof defaultConversationalCapture.capture>[0],
) {
  return defaultConversationalCapture.capture(input);
}

export function changeExplicitSavedItemCapture(
  input: Parameters<typeof defaultConversationalCapture.change>[0],
) {
  return defaultConversationalCapture.change(input);
}

export function undoExplicitSavedItemCapture(
  input: Parameters<typeof defaultConversationalCapture.undo>[0],
) {
  return defaultConversationalCapture.undo(input);
}
