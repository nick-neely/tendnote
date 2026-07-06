"use client";

import type { GeneralActionAssetHint } from "@tendnote/domain";
import { PlusIcon, TagIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Turns persisted hints into editable label strings. */
export function toHintLabels(hints: GeneralActionAssetHint[]): string[] {
  return hints.map((hint) => hint.label);
}

/** Trims hint labels into the server payload, dropping blanks and duplicates. */
export function cleanHintLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label.length > 0 && !seen.has(label)) {
      seen.add(label);
      cleaned.push(label);
    }
  }
  return cleaned;
}

/**
 * A tag-style editor for an Action's lightweight asset hints — subject labels like
 * "refrigerator water filter" or "car registration". Each hint is just a word the
 * user can later act on; this is not asset management, so there are no records,
 * fields, or files behind it (ADR 0156). Type a label and press Enter (or Add) to
 * pin it; remove one with its ✕.
 */
export function ActionAssetHintsField({
  labels,
  onChange,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const label = draft.trim();
    if (label.length === 0 || labels.some((existing) => existing.trim() === label)) {
      setDraft("");
      return;
    }
    onChange([...labels, label]);
    setDraft("");
  }

  function remove(index: number) {
    onChange(labels.filter((_, i) => i !== index));
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[length:var(--text-small)] text-muted-foreground">
        Asset hints (optional)
      </legend>
      {labels.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {labels.map((label, index) => (
            <li
              // Hints have no id while drafting; index is stable within a session.
              // biome-ignore lint/suspicious/noArrayIndexKey: draft chips are positional.
              key={index}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[length:var(--text-caption)] text-muted-foreground"
            >
              <TagIcon aria-hidden className="size-3 shrink-0" />
              <span className="max-w-[24ch] truncate">{label}</span>
              <button
                aria-label={`Remove ${label}`}
                className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => remove(index)}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          aria-label="Add an asset hint"
          className="sm:w-64"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="e.g. refrigerator water filter"
          value={draft}
        />
        <Button disabled={!draft.trim()} onClick={add} size="sm" type="button" variant="ghost">
          <PlusIcon />
          Add
        </Button>
      </div>
    </fieldset>
  );
}
