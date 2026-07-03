"use client";

import { VISIBILITY_CONTROL_OPTIONS, type VisibilityChoice } from "@tendnote/domain/privacy";

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
  const options = choices
    ? VISIBILITY_CONTROL_OPTIONS.filter((option) => choices.includes(option.choice))
    : VISIBILITY_CONTROL_OPTIONS;

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-foreground">Visibility</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <label
            className="flex min-h-24 cursor-pointer flex-col gap-1 rounded-md border border-border bg-card p-3 text-sm transition-colors hover:border-primary/45 has-checked:border-primary has-checked:bg-secondary"
            key={option.choice}
          >
            <span className="flex items-center gap-2 font-medium text-foreground">
              <input
                checked={value === option.choice}
                className="size-4 accent-primary"
                name={name}
                onChange={() => onChoiceChange(option.choice)}
                type="radio"
                value={option.choice}
              />
              {option.label}
            </span>
            <span className="text-muted-foreground text-xs leading-5">{option.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
