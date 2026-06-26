import type {
  SuggestedMemoryReviewComponent,
  SuggestedMemoryReviewResult,
} from "@tendnote/db/queries/memories";
import type { MemoryType, Sensitivity } from "@tendnote/domain";

/**
 * Serializable, fixed-shape view of a suggested-memory review. The component
 * references persisted ids only (ADR 0028); the UI reloads authoritative records
 * before any Save/Edit/Dismiss/Archive, so a refresh never desyncs an action.
 */
export type SuggestedMemoryReviewView = {
  component: SuggestedMemoryReviewComponent;
  memory: {
    id: string;
    personId: string;
    content: string;
    status: string;
    memoryType: MemoryType;
    sensitivity: Sensitivity;
    confidence: string;
    importance: number;
    createdAt: string;
  };
  source: {
    id: string;
    content: string;
    sourceType: string;
    sensitivity: Sensitivity;
    capturedAt: string;
  } | null;
};

export function toSuggestedMemoryReviewView(
  result: SuggestedMemoryReviewResult,
): SuggestedMemoryReviewView {
  return {
    component: result.component,
    memory: {
      id: result.memory.id,
      personId: result.memory.personId,
      content: result.memory.content,
      status: result.memory.status,
      memoryType: result.memory.memoryType,
      sensitivity: result.memory.sensitivity,
      confidence: result.memory.confidence,
      importance: result.memory.importance,
      createdAt: result.memory.createdAt.toISOString(),
    },
    source: result.sourceRecord
      ? {
          id: result.sourceRecord.id,
          content: result.sourceRecord.content,
          sourceType: result.sourceRecord.sourceType,
          sensitivity: result.sourceRecord.sensitivity,
          capturedAt: result.sourceRecord.createdAt.toISOString(),
        }
      : null,
  };
}
