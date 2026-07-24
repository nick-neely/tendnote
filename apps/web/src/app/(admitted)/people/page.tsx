import { connection } from "next/server";
import { AdmittedRoute } from "@/components/admitted-route";
import { PeopleList } from "@/components/people-list";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getCachedPeopleList } from "@/lib/cache/people-views";

export default function PeoplePage() {
  return (
    <AdmittedRoute returnTo="/people" title="People">
      <PeopleContent />
    </AdmittedRoute>
  );
}

async function PeopleContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/people" });
  const people = await getCachedPeopleList({ ownerUserId, limit: 50 });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
          People
        </h1>
        <p className="text-sm text-muted-foreground">
          {people.length === 0
            ? "No one saved yet."
            : people.length === 1
              ? "1 person you're keeping in mind."
              : `${people.length} people you're keeping in mind.`}
        </p>
      </header>

      <PeopleList people={people} />
    </div>
  );
}
