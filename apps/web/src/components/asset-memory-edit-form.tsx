"use client";

import type { AssetMemoryValue } from "@tendnote/domain";
import { useEffect, useId, useRef, useState } from "react";
import {
  acceptSuggestedAssetMemoryAction,
  editSuggestedAssetMemoryAction,
} from "@/app/actions/asset-review";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deriveMemoryDraft, valueDraftFor } from "@/lib/asset-memory-value";
import type { AssetReviewMemoryView } from "@/lib/asset-review-view";

/**
 * The inline edit-before-accept form for one Suggested Asset Memory (#198):
 * label, the typed value in its own input shape (with the currency named for an
 * amount), and freeform notes — each under a small visible caption, not just an
 * aria-label. Apply keeps it suggested; Accept carries the correction with the
 * promotion. A detail keeps substance (never loses both value and notes), and
 * invalid input disables both submit paths with an inline message — accepting
 * can never ship the original value while the input shows rejected text.
 */
export function MemoryEditForm({
  memory,
  run,
  disabled,
  onClose,
}: {
  memory: AssetReviewMemoryView;
  run: (mutate: () => ReturnType<typeof acceptSuggestedAssetMemoryAction>) => void;
  disabled: boolean;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(memory.label);
  const [value, setValue] = useState(() => valueDraftFor(memory.value));
  const [notes, setNotes] = useState(memory.notes ?? "");
  const labelInputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const valueId = useId();

  // Keyboard-first edit: focus lands in the label field on open.
  useEffect(() => {
    labelInputRef.current?.focus();
  }, []);

  const draft = deriveMemoryDraft(memory, { label, value, notes });

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-col gap-1">
        <label
          className="text-[length:var(--text-caption)] text-muted-foreground"
          htmlFor={labelId}
        >
          Label
        </label>
        <Input
          id={labelId}
          onChange={(event) => setLabel(event.target.value)}
          ref={labelInputRef}
          value={label}
        />
      </div>
      {memory.value ? (
        <div className="flex flex-col gap-1">
          <label
            className="text-[length:var(--text-caption)] text-muted-foreground"
            htmlFor={valueId}
          >
            {valueCaptionFor(memory.value)}
          </label>
          <MemoryValueInput
            currency={memory.value.type === "amount" ? memory.value.currency : null}
            id={valueId}
            onChange={setValue}
            value={value}
            valueType={memory.value.type}
          />
          {draft.invalidMessage ? (
            <p className="text-[length:var(--text-caption)] text-destructive" role="alert">
              {draft.invalidMessage}
            </p>
          ) : null}
        </div>
      ) : null}
      <Textarea
        aria-label="Notes"
        className="min-h-[3rem]"
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes (optional)"
        value={notes}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button onClick={onClose} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={disabled || !draft.canApply}
          onClick={() => {
            run(() =>
              editSuggestedAssetMemoryAction({ memoryId: memory.id, edit: draft.buildEdit() }),
            );
            onClose();
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Apply edit
        </Button>
        <Button
          disabled={disabled || !draft.canAccept}
          onClick={() =>
            run(() =>
              acceptSuggestedAssetMemoryAction({ memoryId: memory.id, edit: draft.buildEdit() }),
            )
          }
          size="sm"
          type="button"
        >
          <CheckIcon />
          Accept
        </Button>
      </div>
    </li>
  );
}

/** The visible caption for the typed value input, naming an amount's currency. */
function valueCaptionFor(value: AssetMemoryValue): string {
  if (value.type === "date") {
    return "Date";
  }
  if (value.type === "amount") {
    return `Amount (${value.currency})`;
  }
  return "Value";
}

/** The single typed-value input, shaped by the value's kind. */
function MemoryValueInput({
  valueType,
  value,
  onChange,
  id,
  currency,
}: {
  valueType: AssetMemoryValue["type"];
  value: string;
  onChange: (next: string) => void;
  id: string;
  currency: string | null;
}) {
  if (valueType === "date") {
    return (
      <Input
        className="w-44"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    );
  }
  if (valueType === "amount") {
    return (
      <div className="flex items-center gap-1.5">
        {/* The unit stays visible while editing — "42.99" is never left unitless. */}
        <span
          aria-hidden
          className="font-mono text-[length:var(--text-caption)] text-muted-foreground"
        >
          {currency ?? ""}
        </span>
        <Input
          className="w-40"
          id={id}
          inputMode="decimal"
          min="0"
          onChange={(event) => onChange(event.target.value)}
          step="0.01"
          type="number"
          value={value}
        />
      </div>
    );
  }
  return <Input id={id} onChange={(event) => onChange(event.target.value)} value={value} />;
}
