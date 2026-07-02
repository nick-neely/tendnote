import type { CaptureSourceRecordInput, CaptureSourceRecordResult } from "./types";

/**
 * The shared "log relationship context" sequence both surfaces drive (Eve's
 * capture_source_record tool and the web assistant capture action): capture a Source
 * Record — linked to a known person when identity is certain, otherwise global — then
 * enqueue async suggested-memory extraction (ADR-0015/0017/0032). Capture is the
 * synchronous guarantee; extraction is job-backed and best-effort, so a failed
 * enqueue never makes the saved note disappear. Callers inject their wiring and keep
 * only their own presentation framing (Eve's component vs the web review view), so
 * the branch, the capture-surface metadata, and the swallow-on-failure policy live in
 * one place instead of being hand-assembled per surface.
 */
/** Where a logged-context capture originated, recorded in the Source Record metadata. */
export type CaptureSurface = "eve" | "discord" | "global_assistant" | "person_assistant";

export type CaptureLoggedContextInput = {
  ownerUserId: string;
  retainedContent: string;
  /** Link to an already-resolved person; omit when identity is ambiguous. */
  personId?: string;
  sensitivity?: CaptureSourceRecordInput["sensitivity"];
  /** Where the capture came from, recorded in metadata. */
  captureSurface: CaptureSurface;
};

export type CaptureLoggedContextDeps = {
  /** Capture and link to a known person (the embedding-delivery variant). */
  captureForPerson: (input: {
    ownerUserId: string;
    personId: string;
    retainedContent: string;
    sensitivity?: CaptureSourceRecordInput["sensitivity"];
    metadataJson?: Record<string, unknown>;
  }) => Promise<CaptureSourceRecordResult>;
  /** Capture a global (personless) Source Record. */
  captureGlobal: (input: CaptureSourceRecordInput) => Promise<CaptureSourceRecordResult>;
  /** Enqueue async suggested-memory extraction for the new Source Record. */
  enqueueExtraction: (input: { ownerUserId: string; sourceRecordId: string }) => Promise<unknown>;
};

export async function captureLoggedContext(
  input: CaptureLoggedContextInput,
  deps: CaptureLoggedContextDeps,
): Promise<CaptureSourceRecordResult> {
  const metadataJson = { captureSurface: input.captureSurface };

  // Context-aware path: a known person is captured and linked in one call; an
  // ambiguous capture becomes a global Source Record the user resolves later.
  const result = input.personId
    ? await deps.captureForPerson({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        retainedContent: input.retainedContent,
        sensitivity: input.sensitivity,
        metadataJson,
      })
    : await deps.captureGlobal({
        ownerUserId: input.ownerUserId,
        retainedContent: input.retainedContent,
        sensitivity: input.sensitivity,
        metadataJson,
      });

  // Capture is the synchronous guarantee; suggested-memory extraction is job-backed
  // (ADR-0017/0018) and must never make the saved note disappear when it is
  // unavailable — the Source Record is persisted and can be re-enqueued later.
  try {
    await deps.enqueueExtraction({
      ownerUserId: input.ownerUserId,
      sourceRecordId: result.sourceRecord.id,
    });
  } catch {
    // Best-effort: swallow so the capture still succeeds for the user.
  }

  return result;
}
