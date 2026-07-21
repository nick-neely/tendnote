import type { SavedItemLifecycleStore } from "../saved-items/types";
import { createCaptureOperation } from "./conversational-capture/capture";
import { createCorrectionOperations } from "./conversational-capture/correction";
import type { ConversationalCaptureDeps } from "./conversational-capture/types";

/**
 * Shared owner-scoped Capture product boundary. Routing, destination persistence,
 * correction, and undo stay in focused modules; web and Eve compose this same API.
 */
export function createConversationalCapture(
  store: SavedItemLifecycleStore,
  deps: ConversationalCaptureDeps = {},
) {
  const capture = createCaptureOperation(store, deps);
  const corrections = createCorrectionOperations(store, deps);
  return {
    capture,
    change: corrections.changeSavedItem,
    changeOutcome: corrections.changeOutcome,
    undo: corrections.undoSavedItem,
    undoOutcome: corrections.undoOutcome,
  };
}

export type {
  ConversationalCaptureDeps,
  ConversationalCaptureInput,
} from "./conversational-capture/types";
