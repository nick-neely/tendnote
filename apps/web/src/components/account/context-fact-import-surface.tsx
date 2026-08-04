"use client";

import type { ContextFactImportProviderId } from "@tendnote/domain/context-fact-import";
import Link from "next/link";
import { useState } from "react";
import type {
  AcceptSuggestedContextFactActionInput,
  SuggestedContextFactMutationResult,
} from "@/app/actions/context-fact-review";
import {
  type AssistantHandoffOption,
  ContextFactImportHandoff,
} from "@/components/account/context-fact-import-handoff";
import {
  ContextFactImportPaste,
  type ImportAction,
} from "@/components/account/context-fact-import-paste";
import { ContextFactImportReview } from "@/components/account/context-fact-import-review";
import { ArrowLeftIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { SelfContextImportView } from "@/lib/context-fact-import-view";

export type { AssistantHandoffOption };

type AcceptAction = (
  input: AcceptSuggestedContextFactActionInput,
) => Promise<SuggestedContextFactMutationResult>;

export type ContextFactImportSurfaceProps = {
  options: readonly AssistantHandoffOption[];
  /** The instruction the owner hands to an assistant, built on the server. */
  prompt: string;
  maxTextLength: number;
  backHref: string;
  backLabel: string;
  importAction?: ImportAction;
  acceptAction?: AcceptAction;
};

/**
 * The import round trip: ask an assistant, paste what it said, keep what fits.
 *
 * Each leg keeps its own state next to the markup that uses it, so this holds only
 * what genuinely crosses between them: which assistant the paste came from, what
 * the last import returned, and the one live region the three share. The provider
 * is never guessed - it is what every imported fact's evidence line will claim.
 */
export function ContextFactImportSurface({
  options,
  prompt,
  maxTextLength,
  backHref,
  backLabel,
  importAction,
  acceptAction,
}: ContextFactImportSurfaceProps) {
  const [selected, setSelected] = useState<ContextFactImportProviderId | null>(null);
  const [imported, setImported] = useState<SelfContextImportView | null>(null);
  const [announcement, setAnnouncement] = useState("");

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

      {/* One live region for the whole trip. Anything already visible on the page
          announces itself where it sits rather than being repeated in here. */}
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

      <ContextFactImportPaste
        importAction={importAction}
        maxTextLength={maxTextLength}
        onAnnounce={setAnnouncement}
        onImported={setImported}
        onSelect={setSelected}
        options={options}
        selected={selected}
      />

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
