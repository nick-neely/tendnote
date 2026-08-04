"use client";

import type { ContextFactImportProviderId } from "@tendnote/domain/context-fact-import";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { importSelfContextFactsAction as defaultImportAction } from "@/app/actions/context-fact-import";
import {
  type AcceptSuggestedContextFactActionInput,
  acceptSuggestedContextFactAction as defaultAcceptSuggestedContextFactAction,
  type SuggestedContextFactMutationResult,
} from "@/app/actions/context-fact-review";
import {
  type AssistantHandoffOption,
  ContextFactImportHandoff,
} from "@/components/account/context-fact-import-handoff";
import { ContextFactImportReview } from "@/components/account/context-fact-import-review";
import { ContextFactImportStep } from "@/components/account/context-fact-import-step";
import { AssistantProviderMark } from "@/components/assistant-provider-marks";
import { ArrowLeftIcon, ClipboardTextIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ImportSelfContextFactsActionInput,
  SelfContextImportResult,
  SelfContextImportView,
} from "@/lib/context-fact-import-view";
import { cn } from "@/lib/utils";

export type { AssistantHandoffOption };

type ImportAction = (input: ImportSelfContextFactsActionInput) => Promise<SelfContextImportResult>;
type AcceptAction = (
  input: AcceptSuggestedContextFactActionInput,
) => Promise<SuggestedContextFactMutationResult>;

export type ContextFactImportSurfaceProps = {
  options: readonly AssistantHandoffOption[];
  /** The instruction the owner hands to an assistant, built on the server. */
  prompt: string;
  /** The fence the prompt asks for, used to tell the owner which path a paste will take. */
  blockMarker: string;
  maxTextLength: number;
  backHref: string;
  backLabel: string;
  importAction?: ImportAction;
  acceptAction?: AcceptAction;
};

/**
 * The import round trip: ask an assistant, paste what it said, keep what fits.
 *
 * This owns only the middle leg and the thread between the three. The handoff and
 * the review each keep their own state next to the markup that uses it, because
 * the one thing they genuinely share is which assistant the paste came from, and
 * that is never guessed: it is what every imported fact's evidence line claims.
 */
export function ContextFactImportSurface({
  options,
  prompt,
  blockMarker,
  maxTextLength,
  backHref,
  backLabel,
  importAction = defaultImportAction,
  acceptAction = defaultAcceptSuggestedContextFactAction,
}: ContextFactImportSurfaceProps) {
  const surfaceId = useId();
  const pasteId = `${surfaceId}-paste`;
  const pasteHelperId = `${surfaceId}-paste-helper`;
  const pasteErrorId = `${surfaceId}-paste-error`;

  const [selected, setSelected] = useState<ContextFactImportProviderId | null>(null);
  const [text, setText] = useState("");
  const [clipboardNote, setClipboardNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<SelfContextImportView | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [reading, startReading] = useTransition();
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const looksStructured = text.includes(blockMarker);
  // Over-long is shown, never trimmed away. Silently dropping the tail of a memory
  // export would leave the owner reviewing a partial import that looked complete.
  const overLength = trimmed.length > maxTextLength;

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
      setAnnouncement("Pasted from your clipboard.");
    } catch {
      setClipboardNote("Tendnote could not read your clipboard. Paste into the box instead.");
      pasteRef.current?.focus();
    }
  }

  function read() {
    if (!trimmed) {
      setError("Paste what the assistant gave you.");
      pasteRef.current?.focus();
      return;
    }
    if (!selected) {
      setError("Choose which assistant this came from.");
      return;
    }

    setError(null);
    startReading(async () => {
      try {
        const result = await importAction({ provider: selected, text: trimmed });
        if (!result.ok) {
          setError(result.error);
          pasteRef.current?.focus();
          return;
        }
        setImported(result.view);
        setText("");
      } catch {
        setError("We couldn't read that paste. It is still here, so you can try again.");
        pasteRef.current?.focus();
      }
    });
  }

  function pasteHelperText() {
    if (overLength) {
      return "That is more than one import can carry. Bring over the list of facts rather than the whole conversation.";
    }
    if (!trimmed) return "Private to you. Nothing is saved until you review it.";
    return looksStructured
      ? "Tendnote knows this format and will read it here, so your paste never leaves the app."
      : "No Tendnote block found, so Tendnote will read this with its extraction model.";
  }

  return (
    <section
      aria-labelledby="context-fact-import-heading"
      className="mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-8"
      data-context-fact-import
    >
      <header className="flex min-w-0 flex-col gap-3">
        <Button asChild className="-ml-2.5 w-fit" size="sm" variant="ghost">
          <Link href={backHref}>
            <ArrowLeftIcon aria-hidden data-icon="inline-start" />
            {backLabel}
          </Link>
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal"
            id="context-fact-import-heading"
          >
            Bring over what your assistant knows
          </h1>
          <p className="max-w-[65ch] break-words text-[length:var(--text-body)] leading-[var(--text-body-line)] text-muted-foreground">
            ChatGPT, Claude, and Gemini already remember things you&rsquo;ve told them. Ask one for
            a short summary, paste it back here, and keep only the parts you want.
          </p>
        </div>
      </header>

      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>

      <ContextFactImportHandoff
        onAnnounce={setAnnouncement}
        onSelect={setSelected}
        options={options}
        prompt={prompt}
        selected={selected}
      />

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
              onClick={() => void pasteFromClipboard()}
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
            aria-describedby={error ? `${pasteHelperId} ${pasteErrorId}` : pasteHelperId}
            aria-invalid={error || overLength ? true : undefined}
            autoComplete="off"
            className="min-h-40 min-w-0 resize-y"
            disabled={reading}
            id={pasteId}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste the assistant's answer here."
            ref={pasteRef}
            value={text}
          />
          <p
            className={cn(
              "break-words text-[length:var(--text-small)] leading-[var(--text-small-line)]",
              overLength ? "text-destructive" : "text-muted-foreground",
            )}
            id={pasteHelperId}
          >
            {pasteHelperText()} · {trimmed.length.toLocaleString("en-US")}/
            {maxTextLength.toLocaleString("en-US")} characters
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
              id={pasteErrorId}
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        {/* Only for the owner who arrived with the text already copied. Opening an
            assistant in step 1 answers this, so it stays out of the way until it
            is the one thing missing. */}
        {trimmed && !selected ? (
          <fieldset className="flex min-w-0 flex-col gap-2 rounded-lg border bg-surface px-3.5 py-3">
            <legend className="px-1 text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium">
              Which assistant is this from?
            </legend>
            <div className="flex min-w-0 flex-wrap gap-2">
              {options.map((option) => (
                <Button
                  className="min-h-11"
                  key={option.id}
                  onClick={() => setSelected(option.id)}
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
        ) : null}

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            className="min-h-11 w-full sm:w-auto"
            disabled={reading || !trimmed || !selected || overLength}
            onClick={read}
            type="button"
          >
            {reading ? "Reading…" : "Read this paste"}
          </Button>
          {reading ? (
            <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              Reading what you pasted…
            </span>
          ) : null}
        </div>
      </ContextFactImportStep>

      {imported ? (
        <ContextFactImportReview
          acceptAction={acceptAction}
          backHref={backHref}
          backLabel={backLabel}
          imported={imported}
          onAnnounce={setAnnouncement}
        />
      ) : null}
    </section>
  );
}
