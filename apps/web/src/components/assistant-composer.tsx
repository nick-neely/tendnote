"use client";

import type { ChatStatus } from "ai";
import { useState } from "react";
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
} from "@/components/ai-elements/prompt-input";
import { AssistantCaptureMenu } from "@/components/assistant-capture-menu";
import { AssistantDraftPersistence } from "@/components/assistant-draft-persistence";
import { AssistantEvidenceCapture } from "@/components/assistant-evidence-capture";
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

export function AssistantComposerForm({
  context,
  onStop,
  onSubmit,
  ownerUserId,
  status,
  suggestPersonName = null,
  textareaRef,
}: {
  context?: SelectedPersonContext;
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
  // A plus-menu pick opens the Asset Evidence capture panel above the composer
  // (#201). Evidence routes through the shared capture server actions — never
  // into the turn — so chat gets no attachment model of its own. The chip inside
  // the composer is only a marker that a file is in hand; the menu stays disabled
  // while a capture is open so a second pick can't discard a half-filled form.
  const [captureFile, setCaptureFile] = useState<File | null>(null);

  return (
    <>
      <AssistantDraftPersistence
        onSubmit={onSubmit}
        ownerUserId={ownerUserId}
        ready={status === "ready"}
      />
      {captureFile ? (
        <div className="pb-3">
          <AssistantEvidenceCapture file={captureFile} onClose={() => setCaptureFile(null)} />
        </div>
      ) : null}
      <PromptInput onSubmit={onSubmit}>
        <PromptInputBody>
          {captureFile ? (
            <PromptInputHeader>
              <Attachments variant="inline">
                <Attachment
                  data={captureEvidenceChip(captureFile)}
                  onRemove={() => setCaptureFile(null)}
                >
                  <AttachmentPreview />
                  <AttachmentInfo />
                  {/* The registry reveals this on hover alone, which leaves a Tab
                      stop on an invisible button. */}
                  <AttachmentRemove className={REVEAL_ON_FOCUS} label="Remove the file" />
                </Attachment>
              </Attachments>
            </PromptInputHeader>
          ) : null}
          <PromptInputTextarea
            placeholder={composerPlaceholder(context, suggestPersonName)}
            ref={textareaRef}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <AssistantCaptureMenu disabled={captureFile !== null} onPick={setCaptureFile} />
            <span className="text-[length:var(--text-caption)] text-muted-foreground">
              Enter to send · Shift + Enter for a new line
            </span>
          </PromptInputTools>
          {/* Deliberately never `disabled`: InputGroup fades to 50% around any
              disabled descendant, and the textarea stays usable during a turn,
              so a dimmed composer would misread as "you can't type here". While a
              turn runs the control is Stop; Enter still sends, into the queue. */}
          <PromptInputSubmit onStop={onStop} status={status} />
        </PromptInputFooter>
      </PromptInput>
    </>
  );
}
