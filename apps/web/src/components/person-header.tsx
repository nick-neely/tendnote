import type { PersonDetailCoreView } from "@tendnote/db/queries/people";
import { initials } from "@/lib/dashboard-brief";
import { formatBirthday, titleCase } from "@/lib/person-format";

/**
 * Personal Ledger header: a person, led by their name and the detail you'd
 * actually recall about them — not a stack of badges. Relationship and birthday
 * travel as quiet metadata, never as controls.
 */
export function PersonHeader({ person }: { person: PersonDetailCoreView["person"] }) {
  const meta = [titleCase(person.relationshipType)];

  if (person.birthday) {
    meta.push(`Birthday ${formatBirthday(person.birthday)}`);
  }

  return (
    <header className="flex items-start gap-4" id="person-header">
      <span
        aria-hidden
        className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-medium text-[length:var(--text-h2)] text-primary"
      >
        {initials(person.displayName)}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
        <h1 className="font-display text-[length:var(--text-display)] leading-[var(--text-display-line)] font-semibold tracking-normal">
          {person.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">{meta.join(" · ")}</p>
        {person.profileBlurb ? (
          <p className="mt-1 max-w-[60ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
            {person.profileBlurb}
          </p>
        ) : null}
      </div>
    </header>
  );
}
