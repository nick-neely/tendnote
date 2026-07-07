"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GeneralActionAreaView } from "@/lib/general-action-area-view";

// Radix Select needs a non-empty value per item, so "unfiled" rides a sentinel that
// maps to `null` at the boundary rather than leaking into the data.
const NO_AREA = "__none__";

/**
 * A quiet Area picker for filing an Action. "No area" leads so leaving an Action
 * unfiled is the effortless default (a General Action need not belong to an Area).
 * Archived Areas passed in are shown disabled and suffixed, so an Action already
 * filed under a since-archived Area still displays its label without being newly
 * assignable — matching the one-primary-Area, archive-is-not-delete rules.
 */
export function AreaSelect({
  areas,
  value,
  onChange,
  disabled,
  size = "default",
  triggerClassName,
  ariaLabel = "Area",
}: {
  areas: GeneralActionAreaView[];
  value: string | null;
  onChange: (areaId: string | null) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  triggerClassName?: string;
  ariaLabel?: string;
}) {
  return (
    <Select
      disabled={disabled}
      onValueChange={(next) => onChange(next === NO_AREA ? null : next)}
      value={value ?? NO_AREA}
    >
      <SelectTrigger aria-label={ariaLabel} className={triggerClassName} size={size}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_AREA}>No area</SelectItem>
        {areas.map((area) => (
          <SelectItem disabled={area.archived} key={area.id} value={area.id}>
            {area.archived ? `${area.name} (archived)` : area.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
