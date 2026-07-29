"use client";

import { UserIcon } from "@/components/icons";
import { Toggle } from "@/components/ui/toggle";

/** A person the owner can link to an Action as context. */
export type ActionPersonOption = { id: string; displayName: string };

/**
 * The chip visual, held over the registry Toggle. A Toggle is a button, so the
 * overrides here are the chip's own shape and quiet register (pill, hairline border,
 * small text, border-only hover) taking precedence over the Toggle's default square
 * button treatment. The on state is spelled with both `aria-pressed:` and
 * `data-[state=on]:` because Toggle carries both and sets a background on each.
 */
const PERSON_CHIP =
  "h-auto cursor-pointer gap-1.5 rounded-full border border-border px-3 py-1 font-normal text-[length:var(--text-small)] text-muted-foreground transition-colors hover:border-primary/45 hover:bg-transparent hover:text-muted-foreground aria-pressed:bg-secondary data-[state=on]:border-primary data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground";

/**
 * An optional people-link picker for a General Action. Linking a person adds them as
 * *context* — buy them a gift, book their appointment — without turning the Action
 * into a person-centered Follow-Up (ADR 0155). Deliberately quiet and optional: it
 * only appears when the owner has people, and links nothing by default. Selection is
 * carried by fill and the pressed state, never color alone (DESIGN.md §8).
 */
export function ActionPeopleField({
  people,
  selectedIds,
  onChange,
}: {
  people: ActionPersonOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  if (people.length === 0) {
    return null;
  }

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((personId) => personId !== id));
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[length:var(--text-small)] text-muted-foreground">
        Link people (optional)
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {people.map((person) => (
          <Toggle
            className={PERSON_CHIP}
            key={person.id}
            onPressedChange={(pressed) => toggle(person.id, pressed)}
            pressed={selectedIds.includes(person.id)}
          >
            <UserIcon aria-hidden className="size-3.5" />
            {person.displayName}
          </Toggle>
        ))}
      </div>
    </fieldset>
  );
}
