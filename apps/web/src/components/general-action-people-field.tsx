"use client";

import { UserIcon } from "@/components/icons";

/** A person the owner can link to an Action as context. */
export type ActionPersonOption = { id: string; displayName: string };

/**
 * An optional people-link picker for a General Action. Linking a person adds them as
 * *context* — buy them a gift, book their appointment — without turning the Action
 * into a person-centered Follow-Up (ADR 0155). Deliberately quiet and optional: it
 * only appears when the owner has people, and links nothing by default. Selection is
 * carried by fill and the checkbox state, never color alone (DESIGN.md §8).
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
        {people.map((person) => {
          const checked = selectedIds.includes(person.id);
          return (
            <label
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[length:var(--text-small)] text-muted-foreground transition-colors hover:border-primary/45 has-checked:border-primary has-checked:bg-secondary has-checked:text-secondary-foreground"
              key={person.id}
            >
              <input
                checked={checked}
                className="sr-only"
                onChange={(event) => toggle(person.id, event.target.checked)}
                type="checkbox"
                value={person.id}
              />
              <UserIcon aria-hidden className="size-3.5" />
              {person.displayName}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
