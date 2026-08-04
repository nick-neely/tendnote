"use client";

import type { ContextFactImportProviderId } from "@tendnote/domain/context-fact-import";
import { useState } from "react";
import { ContextFactImportStep } from "@/components/account/context-fact-import-step";
import { AssistantProviderMark } from "@/components/assistant-provider-marks";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type AssistantHandoffOption = {
  id: ContextFactImportProviderId;
  name: string;
  /** Where the owner lands: a prefilled composer, or a plain new chat. */
  href: string;
  prefilled: boolean;
};

type Handoff = {
  provider: AssistantHandoffOption;
  copied: boolean;
  opened: boolean;
};

/**
 * What actually happened when the owner pressed a provider, in their terms.
 *
 * Prefill is unofficial on the one provider that supports it and absent on the
 * other two, and a popup blocker can take the tab either way, so the copy has to
 * cover all four outcomes rather than promise one.
 */
export function handoffLabel(handoff: Handoff): string {
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

export function ContextFactImportHandoff({
  onAnnounce,
  onSelect,
  options,
  prompt,
  selected,
}: {
  onAnnounce: (message: string) => void;
  onSelect: (provider: ContextFactImportProviderId) => void;
  options: readonly AssistantHandoffOption[];
  prompt: string;
  selected: ContextFactImportProviderId | null;
}) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  function openAssistant(provider: AssistantHandoffOption) {
    onSelect(provider.id);
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
      onAnnounce("Prompt copied.");
    } catch {
      setPromptCopied(false);
      onAnnounce("The prompt could not be copied. Select it and copy it yourself.");
    }
  }

  return (
    <ContextFactImportStep
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
                {option.prefilled ? "Opens with the prompt ready" : "Copies the prompt, then opens"}
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
    </ContextFactImportStep>
  );
}
