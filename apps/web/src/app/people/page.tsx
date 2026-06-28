import { searchPeople } from "@tendnote/db/queries/people";
import { AppShell } from "@/components/app-shell";
import { PeopleList } from "@/components/people-list";
import { requireAdmittedOwner } from "@/lib/access/current-access";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const ownerUserId = await requireAdmittedOwner();
  const people = await searchPeople({ ownerUserId, limit: 50 });

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
            People
          </h1>
          <p className="text-sm text-muted-foreground">
            {people.length === 1
              ? "1 person you're keeping in mind."
              : `${people.length} people you're keeping in mind.`}
          </p>
        </header>

        <PeopleList people={people} />
      </div>
    </AppShell>
  );
}
