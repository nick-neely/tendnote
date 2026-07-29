"use client";

import { VISIBILITY_CONTROL_OPTIONS, type VisibilityChoice } from "@tendnote/domain/privacy";
import { useId } from "react";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export function VisibilityChoiceControl({
  value,
  onChoiceChange,
  name = "visibility",
  choices,
}: {
  value: VisibilityChoice;
  onChoiceChange: (choice: VisibilityChoice) => void;
  name?: string;
  choices?: readonly VisibilityChoice[];
}) {
  const fieldId = useId();
  const options = choices
    ? VISIBILITY_CONTROL_OPTIONS.filter((option) => choices.includes(option.choice))
    : VISIBILITY_CONTROL_OPTIONS;

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-foreground">Visibility</legend>
      {/*
       * Radix keeps `name` posting through a hidden mirror input, so the plain
       * form call sites still receive the choice in FormData. Each card wraps its
       * item, which keeps the label implicit - a radio button is labelable, so
       * clicking anywhere on the card still selects it - and the selected tint
       * hangs off the item's own state rather than a `:checked` input.
       */}
      <RadioGroup
        className="grid gap-2 sm:grid-cols-3"
        name={name}
        onValueChange={(choice) => onChoiceChange(choice as VisibilityChoice)}
        value={value}
      >
        {options.map((option) => (
          <label
            className="flex min-h-24 cursor-pointer flex-col gap-1 rounded-md border border-border bg-card p-3 text-sm transition-colors hover:border-primary/45 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-secondary"
            htmlFor={`${fieldId}-${option.choice}`}
            key={option.choice}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <RadioGroupItem id={`${fieldId}-${option.choice}`} value={option.choice} />
              {option.label}
            </span>
            <span className="text-muted-foreground text-xs leading-5">{option.description}</span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
