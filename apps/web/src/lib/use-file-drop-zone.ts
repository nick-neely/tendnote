"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Drag-and-drop for one surface, without the surface having to own a file model.
 *
 * The hook does exactly two things: it says whether a *file* drag is currently
 * over the element (so the caller can draw an overlay), and it hands the dropped
 * files back split by whether their type is one the caller takes. What happens
 * to them afterwards — which one is kept, what the user is told about the rest —
 * is the caller's policy, not this module's.
 */

/** Files from one drop, split by whether their type matched `accept`. */
export type FileDrop = {
  readonly accepted: readonly File[];
  readonly rejected: readonly File[];
};

/**
 * Whether a drag carries files rather than text, a URL, or a page selection.
 *
 * `DataTransfer.files` is empty until the drop lands (browsers withhold the
 * bytes during the drag), so `types` is the only thing that can distinguish a
 * dragged file from dragged text while the pointer is still moving.
 */
function carriesFiles(transfer: DataTransfer | null): boolean {
  return transfer ? [...transfer.types].includes("Files") : false;
}

/**
 * Whether `file` matches one entry of an `accept` list. Exact mime types and
 * `type/*` wildcards only — the two forms a file input's own `accept` attribute
 * understands, so a surface can pass the same list to both. An empty list
 * accepts everything.
 */
export function matchesAccept(file: File, accept: readonly string[]): boolean {
  if (accept.length === 0) {
    return true;
  }
  return accept.some((pattern) =>
    pattern.endsWith("/*") ? file.type.startsWith(pattern.slice(0, -1)) : file.type === pattern,
  );
}

/** Sorts `files` into the ones `accept` covers and the ones it does not. */
export function splitByAccept(files: Iterable<File>, accept: readonly string[]): FileDrop {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) {
    (matchesAccept(file, accept) ? accepted : rejected).push(file);
  }
  return { accepted, rejected };
}

/**
 * Makes `ref`'s element a file drop target and reports whether a file drag is
 * over it right now.
 *
 * Returns the drag flag rather than rendering anything, so the same hook serves
 * a whole panel, a single field, or a page column.
 */
export function useFileDropZone(
  ref: RefObject<HTMLElement | null>,
  {
    accept,
    enabled = true,
    onFiles,
  }: {
    /** Mime types (or `type/*` wildcards) this surface takes. */
    accept: readonly string[];
    /**
     * Whether the surface is taking drops at all. A surface with nowhere to put
     * a file must not invite one: an overlay that promises to attach something
     * and then drops it silently is worse than no drop target.
     */
    enabled?: boolean;
    /** The drop, already split by `accept`. Never called with zero files. */
    onFiles: (drop: FileDrop) => void;
  },
): boolean {
  const [dragging, setDragging] = useState(false);
  // The listeners are attached once, to the element. Reading the callback and
  // the accept list through refs is what lets a parent re-render between a
  // `dragenter` and its `drop` without the listeners being torn down and
  // rebuilt mid-gesture — which would lose the depth count and strand the
  // overlay on screen.
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  // `dragleave` fires every time the pointer crosses into a *child*, so a flat
  // boolean flickers the overlay off over every message, button, and border in
  // the panel. Counting enters against leaves is what makes a surface full of
  // elements read as one target. It is a ref rather than a local because Escape,
  // which lives in its own effect, has to be able to zero it.
  const depthRef = useRef(0);

  useEffect(() => {
    const zone = ref.current;
    if (!zone || !enabled) {
      return;
    }

    const settle = () => {
      depthRef.current = 0;
      setDragging(false);
    };

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) {
        return;
      }
      depthRef.current += 1;
      setDragging(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) {
        return;
      }
      // Without this the browser refuses the drop and navigates to the file.
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) {
        return;
      }
      depthRef.current -= 1;
      if (depthRef.current <= 0) {
        settle();
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) {
        settle();
        return;
      }
      event.preventDefault();
      // Capture phase, and propagation stops here: this must be the *only*
      // handler that sees the drop. `PromptInput` registers a form-level `drop`
      // listener of its own that would put the file into its attachment store,
      // which is the one place an evidence file must never reach (ADR 0185).
      event.stopPropagation();
      settle();
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        onFilesRef.current(splitByAccept(files, acceptRef.current));
      }
    };

    zone.addEventListener("dragenter", onDragEnter, true);
    zone.addEventListener("dragover", onDragOver, true);
    zone.addEventListener("dragleave", onDragLeave, true);
    zone.addEventListener("drop", onDrop, true);
    return () => {
      zone.removeEventListener("dragenter", onDragEnter, true);
      zone.removeEventListener("dragover", onDragOver, true);
      zone.removeEventListener("dragleave", onDragLeave, true);
      zone.removeEventListener("drop", onDrop, true);
    };
  }, [enabled, ref]);

  // Escape takes the overlay down. The browser cancels the drag itself on
  // Escape in most cases, which arrives as a `dragleave`; this covers the rest,
  // so an overlay can never be left painted over a panel the user is trying to
  // read.
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        depthRef.current = 0;
        setDragging(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragging]);

  return dragging && enabled;
}
