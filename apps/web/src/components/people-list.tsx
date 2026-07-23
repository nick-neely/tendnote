"use client";

import type { Person } from "@tendnote/domain";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRightIcon, SearchIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { initials } from "@/lib/dashboard-brief";
import { formatBirthday, titleCase } from "@/lib/person-format";

/**
 * People directory as a calm, scannable list — names first, metadata second, no
 * closeness scores or CRM tiles. Filtering is client-side over the already-loaded
 * set so recall stays instant, in keeping with "fast to capture, fast to recall."
 */
export function PeopleList({ people }: { people: Person[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return people;
    }

    return people.filter((person) =>
      [person.displayName, person.relationshipType, person.profileBlurb ?? ""].some((field) =>
        field.toLowerCase().includes(normalized),
      ),
    );
  }, [people, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search people"
          className="h-10 pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, relationship, or detail"
          value={query}
        />
      </div>

      {filtered.length > 0 ? (
        <div className="divide-y overflow-hidden rounded-xl border bg-surface">
          {filtered.map((person) => (
            <PersonListRow key={person.id} person={person} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center">
          <p className="text-[length:var(--text-small)] text-muted-foreground">
            {query.trim() ? <>No one matches “{query.trim()}”.</> : "No one saved yet."}
          </p>
        </div>
      )}
    </div>
  );
}

function PersonListRow({ person }: { person: Person }) {
  const meta = [titleCase(person.relationshipType)];

  if (person.birthday) {
    meta.push(`Birthday ${formatBirthday(person.birthday)}`);
  }

  return (
    <Link
      className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-panel"
      href={`/people/${person.id}`}
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-medium text-[length:var(--text-small)] text-primary"
      >
        {initials(person.displayName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[length:var(--text-title)] font-medium leading-[var(--text-title-line)]">
          {person.displayName}
        </p>
        <p className="truncate text-[length:var(--text-small)] text-muted-foreground">
          {meta.join(" · ")}
        </p>
      </div>
      <ArrowRightIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}
