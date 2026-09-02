"use client";

import {
  ASSET_EVIDENCE_ALLOWED_MIME_TYPES,
  ASSET_EVIDENCE_FILE_TYPES_LABEL,
} from "@tendnote/domain";
import { useCallback, useState } from "react";
import { type FileDrop, splitByAccept } from "@/lib/use-file-drop-zone";

/**
 * How a file gets from a gesture to the composer's evidence capture panel.
 *
 * There are three gestures and one destination. The "+" menu hands over a file
 * the user chose from a native picker; a drop and an image paste hand over
 * whatever the operating system gave them, which may be several files, of any
 * type. All three end at the same place — `AssistantEvidenceCapture`, and from
 * there the shared Asset Evidence server actions (ADR 0185). The file never
 * enters the Eve turn, which is why the composer has no attachment model of its
 * own and why this module hands around a `File` rather than anything uploaded.
 *
 * The capture panel takes exactly one file and vets it against the domain gate
 * itself (type *and* size, with the domain's own words). This module therefore
 * only has to answer the question the panel cannot: which of several dropped
 * files is the one, and what the user is told about the rest.
 */

/** What the composer is holding, and whatever it owes the user an explanation for. */
export type EvidencePickState = {
  readonly file: File | null;
  readonly note: string | null;
};

/**
 * The composer's state after a drop or a paste: the one file it now holds, plus
 * the quiet line that explains anything the surface could not take. Inline copy
 * rather than a toast — a refused drag is a small correction beside the
 * composer, not an event worth interrupting the page for.
 */
export function pickEvidenceDrop(
  current: EvidencePickState,
  { accepted, rejected }: FileDrop,
): EvidencePickState {
  if (current.file !== null) {
    // The "+" menu disables itself while a capture is open so a second pick
    // cannot discard a half-filled form; a drop keeps the same promise.
    return { file: current.file, note: "Finish or discard the file you already picked." };
  }
  const file = accepted[0] ?? null;
  if (!file) {
    // The domain's own wording for a type it refuses, built from the same
    // allowlist label the drop-zone caption and the rejection message use, so
    // the three can never drift apart.
    return {
      file: null,
      note: rejected.length > 0 ? `Use a ${ASSET_EVIDENCE_FILE_TYPES_LABEL} file.` : null,
    };
  }
  const dropped = accepted.length + rejected.length;
  return { file, note: dropped > 1 ? "One file at a time. Using the first." : null };
}

/**
 * The mime types the composer's drop target takes, which is the domain's own
 * evidence allowlist and nothing else — a surface that accepted more than the
 * seam does would only be inventing rejections one step later.
 */
export const EVIDENCE_DROP_ACCEPT: readonly string[] = ASSET_EVIDENCE_ALLOWED_MIME_TYPES;

/** The composer's evidence pick, however it was made. */
export type EvidencePick = EvidencePickState & {
  /** Put the panel back to holding nothing — the chip's remove, the capture's close. */
  readonly clear: () => void;
  /** Retire the explanation line once the user has moved on from the gesture. */
  readonly dismissNote: () => void;
  /**
   * A direct pick from the "+" menu. It goes straight to the capture panel,
   * which is where a native picker's file has always been vetted.
   */
  readonly pick: (file: File) => void;
  /** A paste: type-filtered here, then one file through. */
  readonly take: (files: Iterable<File>) => void;
  /** A drop, already split against {@link EVIDENCE_DROP_ACCEPT} by the drop zone. */
  readonly takeDrop: (drop: FileDrop) => void;
};

export function useEvidencePick(): EvidencePick {
  const [state, setState] = useState<EvidencePickState>({ file: null, note: null });

  const clear = useCallback(() => setState({ file: null, note: null }), []);

  const dismissNote = useCallback(
    () => setState((current) => (current.note === null ? current : { ...current, note: null })),
    [],
  );

  const pick = useCallback((file: File) => setState({ file, note: null }), []);

  const takeDrop = useCallback(
    (drop: FileDrop) => setState((current) => pickEvidenceDrop(current, drop)),
    [],
  );

  const take = useCallback(
    (files: Iterable<File>) => takeDrop(splitByAccept(files, EVIDENCE_DROP_ACCEPT)),
    [takeDrop],
  );

  return { ...state, clear, dismissNote, pick, take, takeDrop };
}
