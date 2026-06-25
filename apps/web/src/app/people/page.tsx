import { searchPeople } from "@tendnote/db";
import { AppShell } from "@/components/app-shell";
import { PersonCard } from "@/components/person-card";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const people = await searchPeople({ limit: 50 });

  return (
    <AppShell>
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
          People
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Phase 0 includes a read-only people list and detail route backed by shared DB query
          helpers.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((person) => (
          <PersonCard key={person.id} person={person} />
        ))}
      </div>
    </AppShell>
  );
}
