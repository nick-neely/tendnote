"use client";

import type { ChatStatus } from "ai";
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
import type { EvidencePick } from "@/lib/eve/evidence-pick";
import type { SelectedPersonContext } from "@/lib/eve/selected-person-context";
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
 * then a real name suggested by the caller, then a generic prompt. It never
 * invents a name, so an empty notebook is never told about someone it has no
 * record of.
 */
function composerPlaceholder(
  context: SelectedPersonContext | undefined,
  suggestPersonName: string | null,
): string {
  if (context) {
    return `Note something about ${context.personName}…`;
  }

  return suggestPersonName
    ? `Remember something about ${suggestPersonName}…`
    : "Remember something from a conversation today…";
}

/**
 * The picked evidence file as a composer chip. It is display only - the bytes go
 * to the Asset Evidence server actions and never into the turn (ADR 0185) - so
 * the chip carries the name and type and no URL to read the file from.
 */
function captureEvidenceChip(file: File): AttachmentData {
  return {
    filename: file.name,
    id: `evidence:${file.name}`,
    mediaType: file.type || "application/octet-stream",
    type: "file",
    url: "",
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

export function AssistantComposerForm({
  context,
  evidence,
  onStop,
  onSubmit,
  ownerUserId,
  status,
  suggestPersonName = null,
  textareaRef,
}: {
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
  // A pick opens the Asset Evidence capture panel above the composer (#201).
  // Evidence routes through the shared capture server actions — never into the
  // turn — so chat gets no attachment model of its own. The chip inside the
  // composer is only a marker that a file is in hand; the menu stays disabled
  // while a capture is open so a second pick can't discard a half-filled form.
  const captureFile = evidence.file;

  return (
    <>
      <AssistantDraftPersistence
        onSubmit={onSubmit}
        ownerUserId={ownerUserId}
        ready={status === "ready"}
      />
      {captureFile ? (
        <div className="pb-3">
          <AssistantEvidenceCapture file={captureFile} onClose={evidence.clear} />
        </div>
      ) : null}
      <EvidenceNote note={evidence.note} />
      <PromptInput onSubmit={onSubmit}>
        <PromptInputBody>
          {captureFile ? (
            <PromptInputHeader>
              <Attachments variant="inline">
                <Attachment data={captureEvidenceChip(captureFile)} onRemove={evidence.clear}>
                  <AttachmentPreview />
                  <AttachmentInfo />
                  {/* The registry reveals this on hover alone, which leaves a Tab
                      stop on an invisible button. */}
                  <AttachmentRemove className={REVEAL_ON_FOCUS} label="Remove the file" />
                </Attachment>
              </Attachments>
            </PromptInputHeader>
          ) : null}
          <ComposerTextarea
            evidence={evidence}
            placeholder={composerPlaceholder(context, suggestPersonName)}
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
          <ComposerSubmit hasFile={captureFile !== null} onStop={onStop} status={status} />
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
 * Pasting an image goes to the evidence capture instead (ADR 0185); pasting
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
  onStop,
  status,
}: {
  hasFile: boolean;
  onStop: () => void;
  status: ChatStatus;
}) {
  const nothingToSend = useNothingToSend(hasFile, status);

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
