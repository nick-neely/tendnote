"use client";

import type { EveApprovalMode } from "@tendnote/domain";
import { useId, useState, useTransition } from "react";
import { setEveApprovalModeAction } from "@/app/actions/eve-approvals";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const GENERIC_FAILURE = "That didn't go through. Nothing changed.";

/**
 * What each mode actually does, in the terms the owner is choosing between:
 * whether the assistant stops before acting, and what it never stops asking
 * about.
 *
 * The trusted sentence names the exceptions rather than the rule, because the
 * rule is the easy half. Someone turning this on is agreeing to unattended
 * saves, and the only thing they need to carry away is the list of things that
 * still wait for them - so it is a sentence they read while deciding, not a
 * footnote afterwards.
 *
 * "The assistant", never Eve: the framework is not named in owner-facing copy
 * (DESIGN.md §6).
 */
const MODE_OPTIONS: readonly {
  mode: EveApprovalMode;
  label: string;
  description: string;
}[] = [
  {
    mode: "ask",
    label: "Ask every time",
    description:
      "The assistant pauses before saving, changing, sharing, deleting, sending, or fetching anything, and shows you exactly what it will do.",
  },
  {
    mode: "trusted",
    label: "Trusted",
    description:
      "Reversible private saves and changes happen right away. Sharing with your household, deleting, sending, exporting, fetching a web page, and revealing restricted content still ask first.",
  },
];

/**
 * The one place a Tainted Conversation is explained before it happens.
 *
 * It stands under Trusted whichever mode is selected, because it is part of what
 * Trusted means rather than a warning about the current state: reading web
 * content puts a conversation back to asking, and no setting on this page undoes
 * that. Saying it here is what keeps the approval card's own sentence from being
 * the first the owner hears of it.
 */
const TAINT_NOTE =
  "Reading web content in a conversation turns approvals back on for that conversation.";

/**
 * The owner's account-level Approval Mode.
 *
 * One choice, taken immediately, with no confirmation step: both modes are
 * reachable from either, nothing is destroyed by picking one, and a dialog
 * guarding a setting the owner can change back in a click is friction pretending
 * to be care.
 *
 * The selection moves before the write lands and moves back if it fails, so the
 * control never sits inert while a round trip completes. A rollback is honest
 * here precisely because the setting is authoritative elsewhere: the agent's
 * policy reads the mode from the database on every gated call, so a selection
 * that did not persist would otherwise show a promise this page cannot keep.
 */
export function AssistantApprovalSettings({ mode: initialMode }: { mode: EveApprovalMode }) {
  const headingId = useId();
  const fieldId = useId();
  const [mode, setMode] = useState<EveApprovalMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: EveApprovalMode) {
    if (next === mode) return;
    const previous = mode;
    setMode(next);
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await setEveApprovalModeAction({ mode: next });
        if (!outcome.ok) {
          setMode(previous);
          setError(outcome.error || GENERIC_FAILURE);
          return;
        }
        setMode(outcome.view.mode);
      } catch {
        setMode(previous);
        setError(GENERIC_FAILURE);
      }
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          className="font-medium text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
          id={headingId}
        >
          Assistant approvals
        </h2>
        <p className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground">
          How much the assistant does on its own in a conversation.
        </p>
      </div>

      {/*
        Each option's label wraps its own radio, so the whole row is the target
        and the sentence beneath the name is read as part of the choice rather
        than as a note beside it.
      */}
      <RadioGroup
        aria-labelledby={headingId}
        className="grid gap-2"
        onValueChange={(next) => choose(next as EveApprovalMode)}
        value={mode}
      >
        {MODE_OPTIONS.map((option) => (
          <Label
            className="cursor-pointer flex-col items-stretch gap-1 rounded-lg border bg-surface p-3.5 font-normal text-[length:var(--text-body)] transition-colors hover:border-primary/45 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-secondary"
            htmlFor={`${fieldId}-${option.mode}`}
            key={option.mode}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <RadioGroupItem id={`${fieldId}-${option.mode}`} value={option.mode} />
              {option.label}
            </span>
            <span className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              {option.description}
            </span>
            {option.mode === "trusted" ? (
              <span className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                {TAINT_NOTE}
              </span>
            ) : null}
          </Label>
        ))}
      </RadioGroup>

      <p
        className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)] empty:hidden"
        role="status"
      >
        {pending ? "Saving…" : null}
      </p>
      {error ? (
        <p
          className="text-[length:var(--text-small)] text-destructive leading-[var(--text-small-line)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
