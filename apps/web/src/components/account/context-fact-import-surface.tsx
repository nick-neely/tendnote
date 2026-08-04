"use client";

import type { ContextFactView } from "@tendnote/domain";
import type { ContextFactImportProviderId } from "@tendnote/domain/context-fact-import";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import { importSelfContextFactsAction as defaultImportAction } from "@/app/actions/context-fact-import";
import {
  type AcceptSuggestedContextFactActionInput,
  acceptSuggestedContextFactAction as defaultAcceptSuggestedContextFactAction,
  type SuggestedContextFactMutationResult,
} from "@/app/actions/context-fact-review";
import { AssistantProviderMark } from "@/components/assistant-provider-marks";
import { ArrowLeftIcon, CheckIcon, ClipboardTextIcon, CopyIcon } from "@/components/icons";
import { SuggestedContextFactReviewCard } from "@/components/suggested-context-fact-review";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ImportSelfContextFactsActionInput,
  SelfContextImportResult,
  SelfContextImportView,
} from "@/lib/context-fact-import-view";
import {
  contextFactImportEmptyHint,
  contextFactImportHeadline,
  contextFactImportNotes,
  contextFactImportSourceNote,
} from "@/lib/context-fact-import-view";
import type { SuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";
import { cn } from "@/lib/utils";

export type AssistantHandoffOption = {
  id: ContextFactImportProviderId;
  name: string;
  /** Where the owner lands: a prefilled composer, or a plain new chat. */
  href: string;
  prefilled: boolean;
};

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

type Handoff = {
  provider: AssistantHandoffOption;
  copied: boolean;
  opened: boolean;
};

/**
 * The step marker. Caption size in a hairline square, and deliberately quiet:
 * the heading beside it carries the meaning, and nothing here is a score. Not
 * mono, which DESIGN.md keeps for machine facts rather than for looking precise.
 */
function StepMarker({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border text-[length:var(--text-caption)] leading-none text-muted-foreground"
    >
      {children}
    </span>
  );
}

function Step({
  children,
  description,
  headingId,
  step,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  headingId: string;
  step: number;
  title: string;
}) {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <StepMarker>{step}</StepMarker>
          <h2
            className="min-w-0 text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
            id={headingId}
          >
            {title}
          </h2>
        </div>
        {description ? (
          <p className="max-w-[65ch] break-words pl-7 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3 pl-7">{children}</div>
    </section>
  );
}

function handoffLabel(handoff: Handoff): string {
  const { provider, copied, opened } = handoff;
  if (!opened) {
    return copied
      ? `The prompt is on your clipboard. ${provider.name} did not open, so your browser may have blocked the new tab.`
      : `${provider.name} did not open, and the prompt could not be copied. Copy it from below instead.`;
  }
  if (provider.prefilled) {
    return copied
      ? `${provider.name} opened with the prompt ready. It is on your clipboard too, in case the box is empty.`
      : `${provider.name} opened with the prompt ready.`;
  }
  return copied
    ? `The prompt is on your clipboard. Paste it into ${provider.name} and send it.`
    : `${provider.name} opened. The prompt could not be copied automatically, so copy it from below.`;
}

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
  const router = useRouter();
  const surfaceId = useId();
  const pasteId = `${surfaceId}-paste`;
  const pasteHelperId = `${surfaceId}-paste-helper`;
  const pasteErrorId = `${surfaceId}-paste-error`;

  const [handoff, setHandoff] = useState<Handoff | null>(null);
  // Which assistant the paste is from. Opening one picks it; someone who arrives
  // with the text already copied picks it in step 2 instead. It is never guessed,
  // because it is what every imported fact's evidence line will claim.
  const [selected, setSelected] = useState<ContextFactImportProviderId | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [text, setText] = useState("");
  const [clipboardNote, setClipboardNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<SelfContextImportView | null>(null);
  const [reviews, setReviews] = useState<SuggestedContextFactReviewView[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [reading, startReading] = useTransition();
  const [acceptingRest, setAcceptingRest] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  const looksStructured = text.includes(blockMarker);
  // Over-long is shown, never trimmed away. Silently dropping the tail of a memory
  // export would leave the owner reviewing a partial import that looked complete.
  const overLength = trimmed.length > maxTextLength;
  const acceptable = reviews.filter((review) => review.activeMatch === null);

  function openAssistant(provider: AssistantHandoffOption) {
    setSelected(provider.id);
    // Both calls have to start inside this click. Awaiting the clipboard write
    // first would detach `window.open` from the gesture and get the tab blocked,
    // so the copy is kicked off and settled afterwards.
    let copied = false;
    const copying = navigator.clipboard
      ?.writeText(prompt)
      .then(() => {
        copied = true;
      })
      .catch(() => {
        copied = false;
      });

    const opened = window.open(provider.href, "_blank", "noopener,noreferrer") !== null;

    // The outcome is announced by the visible line below, not repeated into the
    // page's live region: one sentence in two places is read to a screen reader twice.
    void Promise.resolve(copying).then(() => setHandoff({ provider, copied, opened }));
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptCopied(true);
      setAnnouncement("Prompt copied.");
    } catch {
      setPromptCopied(false);
      setAnnouncement("The prompt could not be copied. Select it and copy it yourself.");
    }
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
        setReviews(result.view.reviews);
        setText("");
        // Reading is the moment the page changes shape, so the reader is moved to
        // what arrived rather than left at the button they pressed. Moving focus
        // onto the summary is also what announces it, so it is not repeated into
        // the live region.
        window.requestAnimationFrame(() => resultsRef.current?.focus());
      } catch {
        setError("We couldn't read that paste. It is still here, so you can try again.");
        pasteRef.current?.focus();
      }
    });
  }

  function removeReview(contextFactId: string) {
    setReviews((current) => current.filter((review) => review.fact.id !== contextFactId));
  }

  function handleAccepted(fact: ContextFactView) {
    setAnnouncement(`Kept: ${fact.content}`);
  }

  async function acceptRest() {
    if (acceptingRest) return;
    setAcceptingRest(true);
    setError(null);

    let kept = 0;
    const unresolved: string[] = [];
    for (const review of acceptable) {
      try {
        const result = await acceptAction({
          contextFactId: review.fact.id,
          expectedUpdatedAt: review.fact.updatedAt.toISOString(),
        });
        if (result.ok) {
          kept += 1;
          removeReview(review.fact.id);
        } else {
          unresolved.push(review.fact.id);
        }
      } catch {
        unresolved.push(review.fact.id);
      }
    }

    setAcceptingRest(false);
    setAnnouncement(
      unresolved.length === 0
        ? `Kept ${kept} ${kept === 1 ? "fact" : "facts"}.`
        : `Kept ${kept} ${kept === 1 ? "fact" : "facts"}. ${unresolved.length} still needs you.`,
    );
    if (unresolved.length > 0) {
      setError("Some facts could not be kept. They are still below, so try them one at a time.");
    }
    router.refresh();
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

      <Step
        description="Tendnote writes the prompt. It asks only for durable facts about you and nothing about anyone else."
        headingId="context-fact-import-ask-heading"
        step={1}
        title="Ask an assistant"
      >
        <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          {options.map((option) => (
            <li className="min-w-0" key={option.id}>
              <Button
                aria-pressed={selected === option.id}
                // `h-full` so the three read as one row of equal choices: the action
                // lines wrap to different heights and a ragged row would imply the
                // options differ in weight, which they do not.
                className={cn(
                  "h-full min-h-full w-full flex-col items-start gap-1 whitespace-normal px-3.5 py-3 text-left",
                  selected === option.id && "border-ring bg-muted",
                )}
                data-context-fact-import-provider={option.id}
                onClick={() => openAssistant(option)}
                type="button"
                variant="outline"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <AssistantProviderMark provider={option.id} />
                  <span className="truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
                    {option.name}
                  </span>
                </span>
                <span className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] font-normal text-muted-foreground">
                  {option.prefilled
                    ? "Opens with the prompt ready"
                    : "Copies the prompt, then opens"}
                </span>
              </Button>
            </li>
          ))}
        </ul>

        {handoff ? (
          <p
            aria-live="polite"
            className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
            role="status"
          >
            {handoffLabel(handoff)}
          </p>
        ) : null}

        {/* Sending your own memory to a third party deserves to be readable before
            you do it, not after. The prompt is one disclosure away at all times. */}
        <Collapsible className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button className="w-fit" size="sm" type="button" variant="ghost">
                See the prompt
              </Button>
            </CollapsibleTrigger>
            <Button
              className="w-fit"
              onClick={() => void copyPrompt()}
              size="sm"
              type="button"
              variant="ghost"
            >
              {promptCopied ? (
                <CheckIcon aria-hidden data-icon="inline-start" />
              ) : (
                <CopyIcon aria-hidden data-icon="inline-start" />
              )}
              {promptCopied ? "Copied" : "Copy prompt"}
            </Button>
          </div>
          <CollapsibleContent className="min-w-0">
            <pre className="max-h-72 min-w-0 overflow-auto rounded-lg border bg-panel px-3.5 py-3 font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] whitespace-pre-wrap text-muted-foreground">
              {prompt}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </Step>

      <Step
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
            {overLength
              ? "That is more than one import can carry. Bring over the list of facts rather than the whole conversation."
              : trimmed
                ? looksStructured
                  ? "Tendnote knows this format and will read it here, so your paste never leaves the app."
                  : "No Tendnote block found, so Tendnote will read this with its extraction model."
                : "Private to you. Nothing is saved until you review it."}{" "}
            · {trimmed.length.toLocaleString("en-US")}/{maxTextLength.toLocaleString("en-US")}{" "}
            characters
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
      </Step>

      {imported ? (
        <Step
          description="Nothing here is part of About you until you keep it. Edit anything that is not quite right."
          headingId="context-fact-import-review-heading"
          step={3}
          title="Keep what fits"
        >
          <div className="flex min-w-0 flex-col gap-1 outline-none" ref={resultsRef} tabIndex={-1}>
            <p className="break-words text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium">
              {contextFactImportHeadline(imported.summary)}
            </p>
            <p className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              {contextFactImportSourceNote(imported.summary)}
            </p>
            {contextFactImportNotes(imported.summary).map((note) => (
              <p
                className="break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
                key={note}
              >
                {note}
              </p>
            ))}
          </div>

          {reviews.length === 0 ? (
            <EmptyState
              action={
                <Button asChild variant="outline">
                  <Link href={backHref}>{backLabel}</Link>
                </Button>
              }
              description={
                imported.summary.suggestedCount > 0 || imported.summary.alreadyPendingCount > 0
                  ? "You have reviewed everything this import brought over."
                  : contextFactImportEmptyHint(imported.summary)
              }
              title={
                imported.summary.suggestedCount > 0 || imported.summary.alreadyPendingCount > 0
                  ? "Nothing left to review."
                  : "No facts came through."
              }
            />
          ) : (
            <>
              <ul className="flex min-w-0 flex-col gap-2" data-context-fact-import-reviews>
                {reviews.map((review) => (
                  <li key={review.fact.id}>
                    <SuggestedContextFactReviewCard
                      acceptAction={acceptAction}
                      onAccepted={handleAccepted}
                      onResolve={removeReview}
                      review={review}
                    />
                  </li>
                ))}
              </ul>
              {/* Bulk keep covers only the facts with nothing to weigh. Anything that
                  duplicates or contradicts an active fact stays a decision the owner
                  makes with the existing fact in front of them. */}
              {acceptable.length >= 2 ? (
                <Button
                  className="min-h-11 w-full sm:w-fit"
                  disabled={acceptingRest}
                  onClick={() => void acceptRest()}
                  type="button"
                  variant="outline"
                >
                  {acceptingRest ? "Keeping…" : `Keep the ${acceptable.length} without conflicts`}
                </Button>
              ) : null}
            </>
          )}
        </Step>
      ) : null}
    </section>
  );
}
