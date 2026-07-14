"use client";

import { AssetValidationError, assertAssetEvidenceFileAccepted } from "@tendnote/domain";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAssetEvidenceAction,
  addAssetEvidenceToNewAssetAction,
  listAssetEvidenceDestinationsAction,
} from "@/app/actions/asset-evidence";
import { type Draft, EvidenceDetailsForm } from "@/components/asset-evidence-capture";
import { DestinationChooser } from "@/components/assistant-evidence-destination-step";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Button } from "@/components/ui/button";
import {
  type EvidenceCaptureChoice,
  type EvidenceDestination,
  evidenceDestinationTarget,
  resolveEvidenceDestination,
} from "@/lib/asset-evidence-destination";
import type { AssetEvidenceView } from "@/lib/asset-evidence-view";
import { useMutationSubmit } from "@/lib/use-mutation-submit";

/**
 * Eve's chat plus-menu Asset Evidence capture panel (#201): the pick from
 * `assistant-capture-menu.tsx` routes into the SHARED evidence capture path —
 * the same server actions and owner-scoped seam as the Asset Profile drop zone
 * and the review card (#200). Chat gets no attachment model of its own: a pick
 * must land on an existing Asset, a still-open review item, or a review-gated
 * new Suggested Asset — never in an inbox, and never with the file's contents
 * read by Eve (no OCR or file Q&A this phase).
 */

/** The calm confirmation once the capture landed. */
type CaptureDone = { message: string; assetHref: string | null };

/**
 * The inline capture panel a plus-menu pick opens, sitting above the composer —
 * inline on purpose: capture surfaces avoid modal-first flows (DESIGN.md §5).
 * It vets the file, resolves the destination (one candidate is clear from
 * context and gets preselected — still confirmed by the user; several ask;
 * none routes to a review-gated new Suggested Asset), then hands off to the
 * shared details form. Nothing writes until the user submits.
 */
export function AssistantEvidenceCapture({ file, onClose }: { file: File; onClose: () => void }) {
  const router = useRouter();
  const [choice, setChoice] = useState<EvidenceCaptureChoice | null>(null);
  const [done, setDone] = useState<CaptureDone | null>(null);
  const { error, pending, submit } = useMutationSubmit(GENERIC_ERROR);
  const panelRef = useCapturePanelFocus();

  // Vet the pick before anything else renders — the same domain gate the drop
  // zone and the seam apply, so a refused file never reaches a destination step.
  const rejection = useMemo(() => fileRejection(file), [file]);
  const draft = useFileDraft(file);
  const { destinations, loadFailed } = useEvidenceDestinations(rejection !== null, (destination) =>
    setChoice({ kind: "existing", destination }),
  );

  function handleAdded(landed: EvidenceCaptureChoice, view: AssetEvidenceView) {
    setDone(toCaptureDone(landed, view));
    router.refresh();
  }

  return (
    <section
      aria-label="Attach asset evidence"
      className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-3.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      ref={panelRef}
      tabIndex={-1}
    >
      {done ? (
        <CaptureDoneNote done={done} onClose={onClose} />
      ) : rejection ? (
        <CaptureRejection message={rejection} onClose={onClose} />
      ) : (
        <CaptureFlow
          choice={choice}
          destinations={destinations}
          draft={draft}
          error={error}
          loadFailed={loadFailed}
          onChoose={setChoice}
          onClose={onClose}
          pending={pending}
          submit={(formData, chosen) =>
            runCaptureSubmit({ formData, choice: chosen, submit, onAdded: handleAdded })
          }
        />
      )}
    </section>
  );
}

/** The live capture flow: the destination step, then the shared details form. */
function CaptureFlow({
  choice,
  destinations,
  draft,
  error,
  loadFailed,
  pending,
  onChoose,
  onClose,
  submit,
}: {
  choice: EvidenceCaptureChoice | null;
  destinations: EvidenceDestination[] | null;
  draft: Extract<Draft, { mode: "file" }>;
  error: string | null;
  loadFailed: boolean;
  pending: boolean;
  onChoose: (choice: EvidenceCaptureChoice | null) => void;
  onClose: () => void;
  submit: (formData: FormData, choice: EvidenceCaptureChoice) => void;
}) {
  if (choice === null) {
    return (
      <DestinationChooser
        destinations={destinations}
        draft={draft}
        loadFailed={loadFailed}
        onChoose={onChoose}
        onClose={onClose}
      />
    );
  }

  return (
    <>
      <ChosenDestinationLine choice={choice} onChange={() => onChoose(null)} pending={pending} />
      {/* Unframed: the panel already is the card, and cards never nest (DESIGN.md
          §6). Back here means discard — the pick came from the composer's
          plus-menu, so there is no earlier step in the panel to return to; the
          destination is changed by the line above, not by clearing the file. */}
      <EvidenceDetailsForm
        assetScope={choice.kind === "existing" ? choice.destination.scope : "private"}
        backLabel="Discard capture"
        draft={draft}
        error={error}
        framed={false}
        onBack={onClose}
        pending={pending}
        submit={(formData) => submit(formData, choice)}
      />
    </>
  );
}

/**
 * Lands keyboard focus on the panel the moment a plus-menu pick opens it: the
 * menu that had focus is gone, and without this the user is dropped back to
 * <body> and must tab the whole page to reach the capture they just started.
 * The panel names itself ("Attach asset evidence"), so focus arrives somewhere
 * that announces what it is; the details form's own autofocus takes over from
 * here when a clear destination preselects.
 */
function useCapturePanelFocus() {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // One frame late, so the closing menu's own focus restoration can't land
    // after ours and put the user back on the plus button.
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return panelRef;
}

/** The domain gate's message for a refused pick, or null when accepted. */
function fileRejection(file: File): string | null {
  try {
    assertAssetEvidenceFileAccepted({ mimeType: file.type, sizeBytes: file.size });
    return null;
  } catch (cause) {
    return cause instanceof AssetValidationError ? cause.message : GENERIC_ERROR;
  }
}

/** The picked file as the shared details form's draft; the preview object URL
 * lives exactly as long as the draft it backs. */
function useFileDraft(file: File): Extract<Draft, { mode: "file" }> {
  const draft = useMemo<Extract<Draft, { mode: "file" }>>(
    () => ({
      mode: "file",
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }),
    [file],
  );

  useEffect(() => {
    if (!draft.previewUrl) {
      return;
    }
    const url = draft.previewUrl;
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  return draft;
}

/**
 * Loads the capture's destination candidates once (unless the pick was already
 * refused). When exactly one candidate is clear from context it is preselected
 * through `onClearDestination` — the user still confirms before anything writes.
 */
function useEvidenceDestinations(
  skip: boolean,
  onClearDestination: (destination: EvidenceDestination) => void,
): { destinations: EvidenceDestination[] | null; loadFailed: boolean } {
  const [destinations, setDestinations] = useState<EvidenceDestination[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // The preselect callback is only used inside the one-shot load below; a ref
  // keeps a re-rendered closure from re-triggering the effect.
  const onClearRef = useRef(onClearDestination);
  onClearRef.current = onClearDestination;

  useEffect(() => {
    if (skip) {
      return;
    }
    let cancelled = false;
    listAssetEvidenceDestinationsAction()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setDestinations(loaded);
        const resolution = resolveEvidenceDestination(loaded);
        if (resolution.kind === "clear") {
          onClearRef.current(resolution.destination);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [skip]);

  return { destinations, loadFailed };
}

/**
 * Routes the confirmed capture to its shared server action — an existing target
 * through `addAssetEvidenceAction`, a named new thing through the review-gated
 * `addAssetEvidenceToNewAssetAction`. There is no third path.
 */
function runCaptureSubmit({
  formData,
  choice,
  submit,
  onAdded,
}: {
  formData: FormData;
  choice: EvidenceCaptureChoice;
  submit: ReturnType<typeof useMutationSubmit>["submit"];
  onAdded: (choice: EvidenceCaptureChoice, view: AssetEvidenceView) => void;
}): void {
  if (choice.kind === "existing") {
    const target = evidenceDestinationTarget(choice.destination);
    if ("assetId" in target) {
      formData.set("assetId", target.assetId);
    } else {
      formData.set("reviewGroupId", target.reviewGroupId);
    }
    submit(
      () => addAssetEvidenceAction(formData),
      (view: AssetEvidenceView) => onAdded(choice, view),
    );
    return;
  }
  formData.set("assetName", choice.assetName);
  formData.set("assetKind", choice.assetKind);
  submit(
    () => addAssetEvidenceToNewAssetAction(formData),
    ({ evidence }: { evidence: AssetEvidenceView }) => onAdded(choice, evidence),
  );
}

/** Maps a landed capture to its calm confirmation line. */
function toCaptureDone(choice: EvidenceCaptureChoice, view: AssetEvidenceView): CaptureDone {
  if (choice.kind === "new") {
    return {
      message: `"${choice.assetName}" is waiting in Review with ${view.label} attached.`,
      assetHref: null,
    };
  }
  if (choice.destination.targetKind === "review") {
    return {
      message: `Attached to the review item for ${choice.destination.assetName}.`,
      assetHref: null,
    };
  }
  return {
    message: `Attached to ${choice.destination.name}.`,
    assetHref: `/assets/${choice.destination.id}`,
  };
}

/** The capture landed — say where, offer the asset when there is one, and close. */
function CaptureDoneNote({ done, onClose }: { done: CaptureDone; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" />
      <p
        className="min-w-0 flex-1 text-[length:var(--text-small)] leading-[var(--text-small-line)]"
        role="status"
      >
        {done.message}{" "}
        {done.assetHref ? (
          <Link
            className="font-medium text-primary underline underline-offset-2"
            href={done.assetHref}
          >
            View asset
          </Link>
        ) : null}
      </p>
      <Button onClick={onClose} size="sm" type="button" variant="ghost">
        Done
      </Button>
    </div>
  );
}

/** A refused pick: say why (the domain's own words) and offer the way out. */
function CaptureRejection({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <ErrorText message={message} />
      </div>
      <Button onClick={onClose} size="sm" type="button" variant="ghost">
        Dismiss
      </Button>
    </div>
  );
}

/** Where the capture is headed, always changeable until it is submitted. */
function ChosenDestinationLine({
  choice,
  pending,
  onChange,
}: {
  choice: EvidenceCaptureChoice;
  pending: boolean;
  onChange: () => void;
}) {
  const label =
    choice.kind === "new"
      ? `New: ${choice.assetName} — for review`
      : choice.destination.targetKind === "asset"
        ? `Attach to ${choice.destination.name}`
        : `Attach to the review item for ${choice.destination.assetName}`;

  return (
    <div className="flex items-center gap-2">
      <p className="min-w-0 flex-1 truncate text-[length:var(--text-small)] font-medium">{label}</p>
      <Button disabled={pending} onClick={onChange} size="sm" type="button" variant="ghost">
        Change
      </Button>
    </div>
  );
}
