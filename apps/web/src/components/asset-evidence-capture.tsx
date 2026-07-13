"use client";

import type { AssetEvidenceKind, PrivacyScope } from "@tendnote/domain";
import {
  ASSET_EVIDENCE_ALLOWED_MIME_TYPES,
  ASSET_EVIDENCE_FILE_TYPES_LABEL,
  ASSET_EVIDENCE_KIND_OPTIONS,
  ASSET_EVIDENCE_MAX_FILE_BYTES,
  AssetValidationError,
  assertAssetEvidenceFileAccepted,
} from "@tendnote/domain";
import { CameraIcon, Link2Icon, StickyNoteIcon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { addAssetEvidenceAction } from "@/app/actions/asset-evidence";
import { ASSET_EVIDENCE_KIND_ICONS } from "@/components/asset-evidence-shared";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { type AssetEvidenceView, formatEvidenceSize } from "@/lib/asset-evidence-view";
import { useMutationSubmit } from "@/lib/use-mutation-submit";

/** Where a capture lands: an existing Asset, or a still-open review group (#200). */
export type AssetEvidenceCaptureTarget = { assetId: string } | { reviewGroupId: string };

type Draft =
  | { mode: "file"; file: File; previewUrl: string | null }
  | { mode: "link" }
  | { mode: "note" };

/** The kind a fresh capture most likely is; always correctable in the picker. */
function guessKind(draft: Draft): AssetEvidenceKind {
  if (draft.mode === "link") {
    return "link";
  }
  if (draft.mode === "note") {
    return "note";
  }
  return draft.file.type === "application/pdf" ? "manual" : "photo";
}

/** "washer-manual.pdf" → "washer-manual": a label the user can keep or fix. */
function labelFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return base.slice(0, 120) || "Capture";
}

/**
 * The shared Asset Evidence capture flow (#196, #200): one component behind every
 * capture surface — the Asset Profile's evidence section, the Review Queue card,
 * and later Eve's chat plus-menu (#201) — so evidence always routes through the
 * same server action and owner-scoped seam.
 *
 * Desktop leads with a real drop zone (drag, click, keyboard — the same target);
 * small screens add a camera entry that opens the device camera directly. A link
 * or note lives one quiet step away. Picking anything opens the inline details
 * form — kind, label, optional money/date metadata, and the keep-it-private
 * choice under a household asset. Inline on purpose: capture surfaces avoid
 * modal-first flows (DESIGN.md §5).
 */
export function AssetEvidenceCapture({
  target,
  assetScope,
  onAdded,
  onCancel,
}: {
  target: AssetEvidenceCaptureTarget;
  /** The anchor's visibility — household offers the "keep private" narrowing. */
  assetScope: PrivacyScope;
  onAdded: (view: AssetEvidenceView) => void;
  /** Renders a Cancel affordance when the capture sits behind a toggle. */
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const { error, setError, pending, submit } = useMutationSubmit(GENERIC_ERROR);

  // Object URLs live exactly as long as the preview they back.
  useEffect(() => {
    if (draft?.mode !== "file" || !draft.previewUrl) {
      return;
    }
    const url = draft.previewUrl;
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  function chooseFile(file: File) {
    try {
      assertAssetEvidenceFileAccepted({ mimeType: file.type, sizeBytes: file.size });
    } catch (cause) {
      setError(cause instanceof AssetValidationError ? cause.message : GENERIC_ERROR);
      return;
    }
    setError(null);
    setDraft({
      mode: "file",
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    });
  }

  if (draft === null) {
    return (
      <div className="flex flex-col gap-2">
        <EvidenceDropZone onError={setError} onFile={chooseFile} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            onClick={() => setDraft({ mode: "link" })}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Link2Icon />
            Add a link
          </Button>
          <Button
            onClick={() => setDraft({ mode: "note" })}
            size="sm"
            type="button"
            variant="ghost"
          >
            <StickyNoteIcon />
            Add a note
          </Button>
          {onCancel ? (
            <Button className="ml-auto" onClick={onCancel} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
          ) : null}
        </div>
        {error ? <ErrorText message={error} /> : null}
      </div>
    );
  }

  return (
    <EvidenceDetailsForm
      assetScope={assetScope}
      draft={draft}
      error={error}
      onBack={() => {
        setDraft(null);
        setError(null);
      }}
      pending={pending}
      submit={(formData) => {
        if ("assetId" in target) {
          formData.set("assetId", target.assetId);
        } else {
          formData.set("reviewGroupId", target.reviewGroupId);
        }
        submit(
          () => addAssetEvidenceAction(formData),
          (view) => {
            setDraft(null);
            onAdded(view);
          },
        );
      }}
    />
  );
}

/**
 * The capture entry target: one region that is a real button (click, Enter,
 * Space), a drag-and-drop zone, and — on small screens — sits beside a camera
 * entry that opens the device camera directly (mobile image capture, #196).
 */
function EvidenceDropZone({
  onFile,
  onError,
}: {
  onFile: (file: File) => void;
  onError: (message: string | null) => void;
}) {
  const browseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function takeFile(list: FileList | null) {
    const file = list?.[0];
    if (file) {
      onFile(file);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        aria-label="Add evidence: drop a file here or browse"
        className="group flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed bg-surface px-4 py-5 text-center transition-colors duration-150 hover:border-ring/60 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[dragging=true]:border-ring data-[dragging=true]:bg-primary/[0.06] motion-reduce:transition-none"
        data-dragging={dragging}
        onClick={() => browseRef.current?.click()}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onError(null);
          takeFile(event.dataTransfer.files);
        }}
        type="button"
      >
        <UploadIcon
          aria-hidden
          className="size-5 text-muted-foreground transition-colors duration-150 group-hover:text-foreground group-data-[dragging=true]:text-primary motion-reduce:transition-none"
        />
        <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
          {dragging ? (
            "Drop to attach"
          ) : (
            <>
              {/* No drop on a phone — the whole zone is the tap target there. */}
              <span className="sm:hidden">Choose a receipt, photo, or PDF</span>
              <span className="hidden sm:inline">
                Drop a receipt, photo, or PDF — or{" "}
                <span className="font-medium text-primary underline underline-offset-2">
                  browse
                </span>
              </span>
            </>
          )}
        </span>
        {/* Derived from the domain allowlist — the caption can never drift from
            what the seam actually accepts (#200 review). */}
        <span className="text-[length:var(--text-caption)] text-muted-foreground">
          {ASSET_EVIDENCE_FILE_TYPES_LABEL} · up to{" "}
          {Math.floor(ASSET_EVIDENCE_MAX_FILE_BYTES / (1024 * 1024))} MB
        </span>
      </button>

      {/* Camera-first entry where a camera is in hand; the drop zone covers the rest. */}
      <Button
        className="sm:hidden"
        onClick={() => cameraRef.current?.click()}
        type="button"
        variant="outline"
      >
        <CameraIcon />
        Take a photo
      </Button>

      {/* Hidden inputs behind the zone and camera buttons — those carry the
          accessible names, so these stay out of the a11y tree entirely. */}
      <input
        accept={ASSET_EVIDENCE_ALLOWED_MIME_TYPES.join(",")}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          takeFile(event.target.files);
          event.target.value = "";
        }}
        ref={browseRef}
        tabIndex={-1}
        type="file"
      />
      <input
        accept="image/*"
        aria-hidden
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          takeFile(event.target.files);
          event.target.value = "";
        }}
        ref={cameraRef}
        tabIndex={-1}
        type="file"
      />
    </div>
  );
}

/**
 * The inline details step: what was picked, what it is, what to call it, and —
 * only when they say something — money/date metadata and the household privacy
 * narrowing. Small on purpose; every field beyond the label is optional. Only
 * the fields that gate submission (label, link, note) are controlled — the
 * optional metadata is read straight off the form on submit.
 */
function EvidenceDetailsForm({
  draft,
  assetScope,
  pending,
  error,
  submit,
  onBack,
}: {
  draft: Draft;
  assetScope: PrivacyScope;
  pending: boolean;
  error: string | null;
  submit: (formData: FormData) => void;
  onBack: () => void;
}) {
  const [kind, setKind] = useState<AssetEvidenceKind>(() => guessKind(draft));
  const [label, setLabel] = useState(() =>
    draft.mode === "file" ? labelFromFileName(draft.file.name) : "",
  );
  const [substance, setSubstance] = useState("");

  const missingSubstance = draft.mode !== "file" && substance.trim() === "";
  const disabled = pending || !label.trim() || missingSubstance;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    // Named fields (label, url/capturedText, amount, dates, keepPrivate) ride
    // the form itself; the picked file and the select-held kind are added here.
    const formData = new FormData(event.currentTarget);
    formData.set("kind", kind);
    if (draft.mode === "file") {
      formData.set("file", draft.file, draft.file.name);
    }
    submit(formData);
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-3.5"
      onSubmit={handleSubmit}
    >
      {draft.mode === "file" ? <PickedFileStrip draft={draft} onClear={onBack} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <EvidenceLabelInput draft={draft} onChange={setLabel} value={label} />
        <EvidenceKindSelect onChange={setKind} value={kind} />
      </div>

      <EvidenceSubstanceField draft={draft} onChange={setSubstance} value={substance} />
      <EvidenceMetadataDisclosure />

      {assetScope === "household" ? (
        <Label className="flex w-fit items-center gap-2 text-[length:var(--text-small)] font-normal">
          <Checkbox name="keepPrivate" value="true" />
          Keep this just for me
        </Label>
      ) : null}

      {error ? <ErrorText message={error} /> : null}

      <div className="flex items-center justify-end gap-1.5">
        <Button disabled={pending} onClick={onBack} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={disabled} size="sm" type="submit">
          {pending ? <Spinner /> : <UploadIcon />}
          Attach evidence
        </Button>
      </div>
    </form>
  );
}

/** The one required field — autofocused, prefilled from an upload's file name. */
function EvidenceLabelInput({
  draft,
  value,
  onChange,
}: {
  draft: Draft;
  value: string;
  onChange: (value: string) => void;
}) {
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  return (
    <Input
      aria-label="Evidence name"
      className="sm:flex-1"
      name="label"
      onChange={(event) => onChange(event.target.value)}
      placeholder={draft.mode === "link" ? "What is this link?" : "Name this evidence"}
      ref={labelRef}
      value={value}
    />
  );
}

/** The fixed evidence-kind picker, each option under its shared glyph. */
function EvidenceKindSelect({
  value,
  onChange,
}: {
  value: AssetEvidenceKind;
  onChange: (kind: AssetEvidenceKind) => void;
}) {
  return (
    <Select onValueChange={(next) => onChange(next as AssetEvidenceKind)} value={value}>
      <SelectTrigger aria-label="Evidence kind" className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASSET_EVIDENCE_KIND_OPTIONS.map((option) => {
          const KindIcon = ASSET_EVIDENCE_KIND_ICONS[option.kind];
          return (
            <SelectItem key={option.kind} value={option.kind}>
              <KindIcon aria-hidden className="size-4 text-muted-foreground" />
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** A link's url or a note's retained text — the substance a non-file capture needs. */
function EvidenceSubstanceField({
  draft,
  value,
  onChange,
}: {
  draft: Draft;
  value: string;
  onChange: (value: string) => void;
}) {
  if (draft.mode === "link") {
    return (
      <Input
        aria-label="Link URL"
        inputMode="url"
        name="url"
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://…"
        value={value}
      />
    );
  }
  if (draft.mode === "note") {
    return (
      <Textarea
        aria-label="Note text"
        name="capturedText"
        onChange={(event) => onChange(event.target.value)}
        placeholder="The text worth keeping, exactly as captured."
        rows={3}
        value={value}
      />
    );
  }
  return null;
}

/**
 * The optional money/date metadata behind one quiet disclosure. Self-contained:
 * uncontrolled named inputs the submit handler reads straight off the form.
 */
function EvidenceMetadataDisclosure() {
  const detailsId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        aria-controls={detailsId}
        aria-expanded={open}
        className="w-fit rounded-sm text-[length:var(--text-small)] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? "Hide amount & dates" : "Add amount or dates"}
      </button>
      {open ? (
        <div className="flex flex-col gap-2 sm:flex-row" id={detailsId}>
          {/* Implied USD this slice — money is recall metadata, not accounting. */}
          <div className="relative sm:w-32">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[length:var(--text-small)] text-muted-foreground"
            >
              $
            </span>
            <Input
              aria-label="Amount paid in US dollars"
              className="pl-7"
              inputMode="decimal"
              name="amount"
              placeholder="0.00"
            />
          </div>
          <div className="flex flex-1 items-center gap-2 text-[length:var(--text-small)] text-muted-foreground">
            <label className="whitespace-nowrap" htmlFor={`${detailsId}-bought`}>
              Bought
            </label>
            <Input id={`${detailsId}-bought`} name="purchasedOn" type="date" />
          </div>
          <div className="flex flex-1 items-center gap-2 text-[length:var(--text-small)] text-muted-foreground">
            <label className="whitespace-nowrap" htmlFor={`${detailsId}-renews`}>
              Renews
            </label>
            <Input id={`${detailsId}-renews`} name="renewsOn" type="date" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The picked upload, named and sized, with an escape hatch back to the zone. */
function PickedFileStrip({
  draft,
  onClear,
}: {
  draft: Extract<Draft, { mode: "file" }>;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {draft.previewUrl ? (
        // biome-ignore lint/performance/noImgElement: a local object-URL preview of the just-picked file — next/image cannot optimize a blob: URL.
        <img
          alt=""
          className="size-10 shrink-0 rounded-md border object-cover"
          src={draft.previewUrl}
        />
      ) : (
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"
        >
          <UploadIcon className="size-4.5" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[length:var(--text-small)] font-medium">
          {draft.file.name}
        </span>
        <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
          {formatEvidenceSize(draft.file.size)}
        </span>
      </div>
      <Button
        aria-label="Choose a different file"
        onClick={onClear}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </div>
  );
}
