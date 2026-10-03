"use client";

import type { ChatStatus } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Attachment,
  type AttachmentData,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { AssistantCaptureMenu } from "@/components/assistant-capture-menu";
import { AssistantDraftPersistence } from "@/components/assistant-draft-persistence";
import { AssistantEvidenceCapture } from "@/components/assistant-evidence-capture";
import { Button } from "@/components/ui/button";
import type { EvidencePick } from "@/lib/eve/evidence-pick";
import type { SelectedPersonContext } from "@/lib/eve/selected-person-context";
import { attachmentMessage } from "@/lib/files/message";
import { type UploadedFile, uploadFile } from "@/lib/files/upload";
import { REVEAL_ON_FOCUS } from "@/lib/hover-reveal";

/**
 * The box the owner types into, and everything that hangs off it: the evidence
 * chip, the draft mirror, and the submit that morphs into Stop.
 *
 * It is its own module because none of that is about the *conversation* — the
 * panel hands it one callback and a status and gets a message back. Keeping it
 * here is what lets `assistant-panel.tsx` read as the transcript's own file.
 */

/**
 * Composer placeholder, most specific first: the person this panel is scoped to,
 * then the first-run prompt, then a real name suggested by the caller, then a generic prompt. It never
 * invents a name, so an empty notebook is never told about someone it has no
 * record of.
 */
function composerPlaceholder(
  context: SelectedPersonContext | undefined,
  suggestPersonName: string | null,
  composerPrompt: string | null,
): string {
  if (context) {
    return `Note something about ${context.personName}…`;
  }

  if (composerPrompt) return composerPrompt;

  return suggestPersonName
    ? `Remember something about ${suggestPersonName}…`
    : "Remember something from a conversation today…";
}

/** Local attachment chip before its private upload. */
function captureEvidenceChip(file: File, url: string): AttachmentData {
  return {
    filename: file.name,
    id: `evidence:${file.name}`,
    mediaType: file.type || "application/octet-stream",
    type: "file",
    url,
  };
}

/**
 * Whether the submit has nothing to act on: an idle session, an empty line, and
 * no file in hand.
 *
 * While a turn runs the control is Stop, and a line typed during a turn is the
 * queue's — both are real actions, so neither is ever blocked here. The text is
 * read from the shared controller rather than mirrored into local state,
 * because the draft restore and the queue both write to it and a second copy
 * would go stale the moment either did.
 */
function useNothingToSend(hasFile: boolean, status: ChatStatus): boolean {
  const { textInput } = usePromptInputController();
  return status === "ready" && !hasFile && textInput.value.trim() === "";
}

function useAttachmentPreview(file: File | null) {
  const previewUrl = useMemo(
    () => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : ""),
    [file],
  );
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  return previewUrl;
}

/** Owns upload progress and retry state independently of composer rendering. */
function useAttachmentSubmission(
  evidence: EvidencePick,
  onSubmit: (message: PromptInputMessage) => Promise<void>,
  onSubmitted: () => void,
) {
  const captureFile = evidence.file;
  const currentFile = useRef(captureFile);
  currentFile.current = captureFile;
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploading = useRef(false);
  const uploaded = useRef<{ file: File; result: UploadedFile } | null>(null);
  async function submit(message: PromptInputMessage) {
    if (uploading.current) throw new Error("Upload in progress.");
    if (!captureFile) return onSubmit(message);
    uploading.current = true;
    setUploadError(null);
    try {
      let result = uploaded.current?.file === captureFile ? uploaded.current.result : null;
      if (!result) {
        setUploadProgress(0);
        result = await uploadFile(captureFile, setUploadProgress);
        uploaded.current = { file: captureFile, result };
      }
      setUploadProgress(null);
      await onSubmit({ ...message, text: attachmentMessage(message.text, result) });
      if (currentFile.current === captureFile) {
        evidence.clear();
        onSubmitted();
      }
      uploaded.current = null;
    } catch (cause) {
      setUploadError(
        cause instanceof Error ? cause.message : "Could not send the file. Try again.",
      );
      throw cause;
    } finally {
      uploading.current = false;
      setUploadProgress(null);
    }
  }

  return { submit, uploadProgress, uploadError, setUploadError };
}

export function AssistantComposerForm({
  composerPrompt = null,
  context,
  evidence,
  onStop,
  onSubmit,
  ownerUserId,
  status,
  suggestPersonName = null,
  textareaRef,
}: {
  /** The first-run prompt, standing in for the unscoped placeholder (#639). */
  composerPrompt?: string | null;
  context?: SelectedPersonContext;
  /**
   * The file in hand and the three ways one arrives (#201). The state lives in
   * the panel because the whole conversation surface is a drop target, not just
   * this box — see `assistant-panel.tsx`.
   */
  evidence: EvidencePick;
  onStop: () => void;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  ownerUserId: string;
  /**
   * The turn status as the submit button renders it. `resuming` (reattaching to
   * a turn already running server-side) has no button of its own and is live
   * work, so the panel narrows it to the same spinner a freshly sent turn shows.
   */
  status: ChatStatus;
  suggestPersonName?: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const captureFile = evidence.file;
  const previewUrl = useAttachmentPreview(captureFile);
  const [saveToAsset, setSaveToAsset] = useState(false);
  const { submit, uploadProgress, uploadError, setUploadError } = useAttachmentSubmission(
    evidence,
    onSubmit,
    () => setSaveToAsset(false),
  );

  return (
    <>
      <AssistantDraftPersistence
        onSubmit={submit}
        ownerUserId={ownerUserId}
        ready={status === "ready"}
      />
      {captureFile && saveToAsset ? (
        <div className="pb-3">
          <AssistantEvidenceCapture file={captureFile} onClose={() => setSaveToAsset(false)} />
        </div>
      ) : null}
      <EvidenceNote note={evidence.note} />
      {uploadProgress !== null ? (
        <p role="status" className="pb-2 text-[length:var(--text-small)] text-muted-foreground">
          Uploading file… {Math.round(uploadProgress)}%
        </p>
      ) : null}
      {uploadError ? (
        <p role="alert" className="pb-2 text-[length:var(--text-small)] text-destructive">
          {uploadError}
        </p>
      ) : null}
      {/* A disabled menu or Send button must not dim the editable composer. */}
      <PromptInput
        className="[&>[data-slot=input-group]]:bg-transparent [&>[data-slot=input-group]]:opacity-100"
        onSubmit={submit}
      >
        <PromptInputBody>
          {captureFile ? (
            <PromptInputHeader>
              <Attachments variant="inline">
                <Attachment
                  data={captureEvidenceChip(captureFile, previewUrl)}
                  onRemove={() => {
                    evidence.clear();
                    setSaveToAsset(false);
                    setUploadError(null);
                  }}
                >
                  <AttachmentPreview />
                  <AttachmentInfo />
                  {/* The registry reveals this on hover alone, which leaves a Tab
                      stop on an invisible button. */}
                  <AttachmentRemove className={REVEAL_ON_FOCUS} label="Remove the file" />
                </Attachment>
              </Attachments>
              <div className="flex flex-wrap items-center gap-2 text-[length:var(--text-caption)] text-muted-foreground">
                <span>
                  {["image/heic", "image/heif"].includes(captureFile.type)
                    ? "Save this image to an Asset. For the Assistant to read it, attach a JPEG, PNG, WebP, or PDF copy."
                    : "Sent with your next message for the Assistant to read."}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSaveToAsset((open) => !open)}
                >
                  Save to an Asset
                </Button>
              </div>
            </PromptInputHeader>
          ) : null}
          <ComposerTextarea
            evidence={evidence}
            placeholder={composerPlaceholder(context, suggestPersonName, composerPrompt)}
            status={status}
            textareaRef={textareaRef}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <AssistantCaptureMenu disabled={captureFile !== null} onPick={evidence.pick} />
            <span className="text-[length:var(--text-caption)] text-muted-foreground">
              Enter to send · Shift + Enter for a new line
            </span>
          </PromptInputTools>
          <ComposerSubmit
            busy={uploadProgress !== null}
            hasFile={captureFile !== null}
            onStop={onStop}
            status={status}
          />
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}

/**
 * What the composer could not take from a drop or a paste, in one line above the
 * box. `status` rather than `alert`: nothing is broken and nothing was lost —
 * the file is still on the user's disk and the gesture is repeatable.
 */
function EvidenceNote({ note }: { note: string | null }) {
  if (!note) {
    return null;
  }
  return (
    <p
      className="pb-2 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
      role="status"
    >
      {note}
    </p>
  );
}

/**
 * The textarea, plus the two gestures the registry would otherwise route into
 * its own attachment store.
 *
 * Pasting an image picks a chat attachment; pasting
 * text is left entirely alone. Enter on a composer with nothing to send is
 * swallowed here rather than left to raise an empty submit — the registry's own
 * Enter path checks the submit button's `disabled` property, which this
 * composer deliberately does not set (see {@link ComposerSubmit}).
 */
function ComposerTextarea({
  evidence,
  placeholder,
  status,
  textareaRef,
}: {
  evidence: EvidencePick;
  placeholder: string;
  status: ChatStatus;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const nothingToSend = useNothingToSend(evidence.file !== null, status);

  return (
    <PromptInputTextarea
      onChange={evidence.dismissNote}
      onKeyDown={(event) => {
        if (nothingToSend && event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
        }
      }}
      onPaste={(event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0) {
          return;
        }
        event.preventDefault();
        evidence.take(files);
      }}
      placeholder={placeholder}
      ref={textareaRef}
    />
  );
}

/**
 * Send, Stop, and the one state where neither is an honest offer.
 *
 * `aria-disabled` rather than `disabled`: `InputGroup` fades to 50% and tints
 * its background around *any* disabled descendant, so a natively disabled
 * submit would dim the whole composer — including the textarea the user is
 * meant to type into to make it enabled again. The treatment instead mirrors
 * `Button`'s own authored disabled pair (muted surface, muted-foreground ink,
 * ~7:1 in both themes) onto the aria state, and the click is refused here while
 * Enter is refused in {@link ComposerTextarea}.
 */
function ComposerSubmit({
  hasFile,
  busy = false,
  onStop,
  status,
}: {
  hasFile: boolean;
  busy?: boolean;
  onStop: () => void;
  status: ChatStatus;
}) {
  const nothingToSend = useNothingToSend(hasFile, status) || busy;

  return (
    <PromptInputSubmit
      aria-disabled={nothingToSend || undefined}
      className={
        nothingToSend
          ? "aria-disabled:cursor-default aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:active:translate-y-0 aria-disabled:hover:bg-muted aria-disabled:hover:text-muted-foreground"
          : undefined
      }
      onClick={nothingToSend ? (event) => event.preventDefault() : undefined}
      onStop={onStop}
      status={status}
    />
  );
}
