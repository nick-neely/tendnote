"use client";

import {
  type ContextFactImportProviderId,
  hasReadableContextFactImportBlock,
} from "@tendnote/domain/context-fact-import";
import { useId, useRef, useState, useTransition } from "react";
import { importSelfContextFactsAction as defaultImportAction } from "@/app/actions/context-fact-import";
import type { AssistantHandoffOption } from "@/components/account/context-fact-import-handoff";
import { ContextFactImportStep } from "@/components/account/context-fact-import-step";
import { AssistantProviderMark } from "@/components/assistant-provider-marks";
import { ClipboardTextIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ImportSelfContextFactsActionInput,
  SelfContextImportResult,
  SelfContextImportView,
} from "@/lib/context-fact-import-view";
import { cn } from "@/lib/utils";

export type ImportAction = (
  input: ImportSelfContextFactsActionInput,
) => Promise<SelfContextImportResult>;

/**
 * What the owner is told about their paste before they commit it.
 *
 * The recognised-format line is a promise about where private text is going, so
 * it asks the same question the import asks rather than merely looking for the
 * fence. Over-length reports the limit instead: the paste is never trimmed on the
 * way in, because a silently dropped tail would look like a complete import.
 */
function pasteHelperText(input: {
  overLength: boolean;
  hasText: boolean;
  readableHere: boolean;
}): string {
  if (input.overLength) {
    return "That is more than one import can carry. Bring over the list of facts rather than the whole conversation.";
  }
  if (!input.hasText) return "Private to you. Nothing is saved until you review it.";
  return input.readableHere
    ? "Tendnote knows this format and will read it here, so your paste never leaves the app."
    : "No Tendnote block found, so Tendnote will read this with its extraction model.";
}

function PasteStatus({
  clipboardNote,
  error,
  errorId,
  helperId,
  helperText,
  overLength,
}: {
  clipboardNote: string | null;
  error: string | null;
  errorId: string;
  helperId: string;
  helperText: string;
  overLength: boolean;
}) {
  return (
    <>
      <p
        className={cn(
          "break-words text-[length:var(--text-small)] leading-[var(--text-small-line)]",
          overLength ? "text-destructive" : "text-muted-foreground",
        )}
        id={helperId}
      >
        {helperText}
      </p>
      {clipboardNote ? (
        <p
          aria-live="polite"
          className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
          role="status"
        >
          {clipboardNote}
        </p>
      ) : null}
      {error ? (
        <p
          className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-destructive"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * Only for the owner who arrived with the text already copied. Opening an assistant
 * in step 1 answers this, so it stays out of the way until it is the one thing
 * missing - and it is never guessed, because it is what every imported fact's
 * evidence line will claim.
 */
function PasteProviderChooser({
  onSelect,
  options,
}: {
  onSelect: (provider: ContextFactImportProviderId) => void;
  options: readonly AssistantHandoffOption[];
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-lg border bg-surface px-3.5 py-3">
      <legend className="px-1 text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium">
        Which assistant is this from?
      </legend>
      <div className="flex min-w-0 flex-wrap gap-2">
        {options.map((option) => (
          <Button
            className="min-h-11"
            key={option.id}
            onClick={() => onSelect(option.id)}
            type="button"
            variant="outline"
          >
            <AssistantProviderMark
              className="size-4"
              data-icon="inline-start"
              provider={option.id}
            />
            {option.name}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * How a paste becomes an import: what the owner typed, whether it can be read, and
 * the two ways it gets there. Kept apart from the markup because it is the step's
 * state machine rather than its chrome - a future drop-zone or file path would
 * want exactly this and different chrome around it.
 */
function usePasteImport({
  importAction,
  maxTextLength,
  onAnnounce,
  onImported,
  selected,
}: {
  importAction: ImportAction;
  maxTextLength: number;
  onAnnounce: (message: string) => void;
  onImported: (view: SelfContextImportView) => void;
  selected: ContextFactImportProviderId | null;
}) {
  const [text, setTextValue] = useState("");
  const [clipboardNote, setClipboardNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const overLength = trimmed.length > maxTextLength;

  /**
   * Editing retracts whatever the last attempt said. A failure message and its
   * `aria-invalid` left standing over replaced text describes content the owner
   * can no longer see.
   */
  function setText(next: string) {
    setTextValue(next);
    setError(null);
    setClipboardNote(null);
  }

  async function pasteFromClipboard() {
    setClipboardNote(null);
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        setClipboardNote("Your clipboard is empty. Copy the assistant's answer first.");
        return;
      }
      setText(clipboardText);
      setError(null);
      pasteRef.current?.focus();
      onAnnounce("Pasted from your clipboard.");
    } catch {
      setClipboardNote("Tendnote could not read your clipboard. Paste into the box instead.");
      pasteRef.current?.focus();
    }
  }

  function read() {
    if (!trimmed || !selected) return;
    setError(null);
    startReading(async () => {
      try {
        const result = await importAction({ provider: selected, text: trimmed });
        if (!result.ok) {
          setError(result.error);
          pasteRef.current?.focus();
          return;
        }
        onImported(result.view);
        setText("");
      } catch {
        setError("We couldn't read that paste. It is still here, so you can try again.");
        pasteRef.current?.focus();
      }
    });
  }

  return {
    canRead: !reading && !overLength && trimmed.length > 0 && selected !== null,
    clipboardNote,
    error,
    hasText: trimmed.length > 0,
    overLength,
    pasteFromClipboard,
    pasteRef,
    read,
    reading,
    setText,
    text,
    trimmedLength: trimmed.length,
  };
}

export function ContextFactImportPaste({
  importAction = defaultImportAction,
  maxTextLength,
  onAnnounce,
  onImported,
  onSelect,
  options,
  selected,
}: {
  importAction?: ImportAction;
  maxTextLength: number;
  onAnnounce: (message: string) => void;
  onImported: (view: SelfContextImportView) => void;
  onSelect: (provider: ContextFactImportProviderId) => void;
  options: readonly AssistantHandoffOption[];
  selected: ContextFactImportProviderId | null;
}) {
  const pasteId = useId();
  const helperId = `${pasteId}-helper`;
  const errorId = `${pasteId}-error`;
  const paste = usePasteImport({ importAction, maxTextLength, onAnnounce, onImported, selected });
  const describedBy = paste.error ? `${helperId} ${errorId}` : helperId;

  return (
    <ContextFactImportStep
      description="Copy the assistant's whole answer. Tendnote reads the facts out of it."
      headingId="context-fact-import-paste-heading"
      step={2}
      title="Paste it back"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Label htmlFor={pasteId}>What the assistant said</Label>
          <Button
            className="w-fit"
            onClick={() => void paste.pasteFromClipboard()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ClipboardTextIcon aria-hidden data-icon="inline-start" />
            Paste from clipboard
          </Button>
        </div>
        {/* No `maxLength`: the browser would truncate a long paste on the way in
            and the owner would review a partial import that looked whole. The
            count below turns to a limit the owner can act on instead. */}
        <Textarea
          aria-describedby={describedBy}
          aria-invalid={paste.error || paste.overLength ? true : undefined}
          autoComplete="off"
          className="min-h-40 min-w-0 resize-y"
          disabled={paste.reading}
          id={pasteId}
          onChange={(event) => paste.setText(event.target.value)}
          placeholder="Paste the assistant's answer here."
          ref={paste.pasteRef}
          value={paste.text}
        />
        <PasteStatus
          clipboardNote={paste.clipboardNote}
          error={paste.error}
          errorId={errorId}
          helperId={helperId}
          helperText={`${pasteHelperText({
            overLength: paste.overLength,
            hasText: paste.hasText,
            readableHere: hasReadableContextFactImportBlock(paste.text),
          })} · ${paste.trimmedLength.toLocaleString("en-US")}/${maxTextLength.toLocaleString(
            "en-US",
          )} characters`}
          overLength={paste.overLength}
        />
      </div>

      {paste.hasText && !selected ? (
        <PasteProviderChooser onSelect={onSelect} options={options} />
      ) : null}

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          className="min-h-11 w-full sm:w-auto"
          disabled={!paste.canRead}
          onClick={paste.read}
          type="button"
        >
          {paste.reading ? "Reading…" : "Read this paste"}
        </Button>
        {paste.reading ? (
          <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            Reading what you pasted…
          </span>
        ) : null}
      </div>
    </ContextFactImportStep>
  );
}
