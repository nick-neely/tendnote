"use client";

import type {
  ContactImportCandidateTarget,
  ContactImportPreviewCandidate,
} from "@tendnote/db/queries/contacts-import-preview";
import { TriangleAlertIcon, UsersRoundIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Candidate = ContactImportPreviewCandidate;

export type ResolutionChoice = {
  targetPersonId?: string | null;
  createPerson?: boolean;
  birthdayChoice?: "provider" | "existing" | "skip";
};

type ResolutionProps = {
  candidate: Candidate;
  busy: boolean;
  onApply: (resolution: ResolutionChoice) => void;
  onSkip: () => void;
};

/**
 * The inline decision zone for a row the workflow would not import on its own.
 *
 * Every eligibility rule below is decided by the workflow and read straight from
 * `candidate.decisions`; the UI never re-derives who can be a target, whether a new
 * person may be created, or when a birthday choice is required. This component only
 * routes: a candidate with named targets gets the attach form, everything else gets
 * the create-or-skip fallback.
 */
export function ResolutionZone({ candidate, busy, onApply, onSkip }: ResolutionProps) {
  const hasNamedTarget = candidate.decisions.targets.length > 0;

  return (
    // Recessed decision zone stepped down onto --panel, full-bleed to the row
    // edges (clipped by the table's rounded overflow-hidden). Flat: border +
    // fill, no shadow, no nested card.
    <div className="flex flex-col gap-2.5 border-t bg-panel px-3.5 py-3">
      <ResolutionNotes candidate={candidate} />
      {hasNamedTarget ? (
        <TargetResolutionForm busy={busy} candidate={candidate} onApply={onApply} onSkip={onSkip} />
      ) : (
        <FallbackResolutionActions
          busy={busy}
          candidate={candidate}
          onApply={onApply}
          onSkip={onSkip}
        />
      )}
    </div>
  );
}

/** Why this row needs a human: the workflow's conflicts, then its advisory matches. */
function ResolutionNotes({ candidate }: { candidate: Candidate }) {
  if (candidate.conflicts.length === 0 && candidate.advisoryMatches.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-col gap-1">
      {candidate.conflicts.map((conflict) => (
        <NoteItem key={`${conflict.type}:${conflict.message}`}>
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-accent" />
          <span>{conflict.message}</span>
        </NoteItem>
      ))}
      {candidate.advisoryMatches.map((match) => (
        <NoteItem key={`${match.personId}:${match.reason}`}>
          <UsersRoundIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Advisory: {match.displayName} · {match.reason}
          </span>
        </NoteItem>
      ))}
    </ul>
  );
}

function NoteItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
      {children}
    </li>
  );
}

/**
 * Attach this contact to a person the workflow offered. Holds the row's unsubmitted
 * choices; a candidate's decisions never change under it, so this form is the only
 * place that state needs to live.
 */
function TargetResolutionForm({ candidate, busy, onApply, onSkip }: ResolutionProps) {
  const { targets, targetChoiceRequired, birthdayChoiceRequired } = candidate.decisions;
  const [targetPersonId, setTargetPersonId] = useState(
    targetChoiceRequired ? "" : (targets[0]?.personId ?? ""),
  );
  const [birthdayChoice, setBirthdayChoice] = useState<"existing" | "provider">("existing");

  return (
    <div className="flex flex-col gap-2">
      {targetChoiceRequired ? (
        <TargetChooser
          name={`target-${candidate.id}`}
          onChange={setTargetPersonId}
          selected={targetPersonId}
          targets={targets}
        />
      ) : null}
      {birthdayChoiceRequired ? (
        <BirthdayChooser
          name={`birthday-${candidate.id}`}
          onChange={setBirthdayChoice}
          selected={birthdayChoice}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={busy || (targetChoiceRequired && !targetPersonId)}
          onClick={() =>
            onApply({
              targetPersonId: targetPersonId || null,
              birthdayChoice: birthdayChoiceRequired ? birthdayChoice : undefined,
            })
          }
          size="sm"
          variant="outline"
        >
          Apply resolution
        </Button>
        <SkipButton busy={busy} onSkip={onSkip} />
      </div>
    </div>
  );
}

function TargetChooser({
  targets,
  selected,
  name,
  onChange,
}: {
  targets: readonly ContactImportCandidateTarget[];
  selected: string;
  name: string;
  onChange: (personId: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-foreground">
        Choose target person
      </legend>
      {/* Heavily-matched contacts stay calm: cap the height and scroll the
          overflow rather than letting the row grow unbounded. */}
      <div
        className={
          targets.length > TARGET_LIST_CAP
            ? "flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-1"
            : "flex flex-col gap-1.5"
        }
      >
        {targets.map((target) => (
          <RadioOption
            checked={selected === target.personId}
            key={target.personId}
            label={target.label}
            name={name}
            onSelect={() => onChange(target.personId)}
            value={target.personId}
          />
        ))}
      </div>
    </fieldset>
  );
}

function BirthdayChooser({
  selected,
  name,
  onChange,
}: {
  selected: "existing" | "provider";
  name: string;
  onChange: (choice: "existing" | "provider") => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[length:var(--text-small)] font-medium text-muted-foreground">
        Birthday
      </legend>
      <RadioOption
        checked={selected === "existing"}
        label="Keep Tendnote birthday"
        name={name}
        onSelect={() => onChange("existing")}
      />
      <RadioOption
        checked={selected === "provider"}
        label="Use provider birthday"
        name={name}
        onSelect={() => onChange("provider")}
      />
    </fieldset>
  );
}

function RadioOption({
  checked,
  label,
  name,
  onSelect,
  value,
}: {
  checked: boolean;
  label: string;
  name: string;
  onSelect: () => void;
  value?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
      <input
        checked={checked}
        className={RADIO_CLASS}
        name={name}
        onChange={onSelect}
        type="radio"
        value={value}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * No named target: the row can only become a new person (when the workflow allows
 * it) or be skipped. A skip-only row explains why there is nothing else to press.
 */
function FallbackResolutionActions({ candidate, busy, onApply, onSkip }: ResolutionProps) {
  const { canCreatePerson, resolvable } = candidate.decisions;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canCreatePerson ? (
        <Button
          disabled={busy}
          onClick={() => onApply({ createPerson: true })}
          size="sm"
          variant="outline"
        >
          Create new person
        </Button>
      ) : null}
      {resolvable ? null : (
        <p className="flex-1 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          This contact matches more than one person. Open those people to attach or merge it, or
          skip it here.
        </p>
      )}
      <SkipButton busy={busy} onSkip={onSkip} />
    </div>
  );
}

function SkipButton({ busy, onSkip }: { busy: boolean; onSkip: () => void }) {
  return (
    <Button disabled={busy} onClick={onSkip} size="sm" variant="ghost">
      Skip
    </Button>
  );
}

const RADIO_CLASS =
  "size-4 shrink-0 rounded-full [accent-color:var(--primary)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

// Above this many possible targets, scroll the radio list instead of growing
// the row; keeps heavily-matched contacts calm.
const TARGET_LIST_CAP = 4;
