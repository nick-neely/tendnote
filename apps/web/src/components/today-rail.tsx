import type { Person } from "@tendnote/domain";
import { ArrowRightIcon, CakeIcon, InboxIcon } from "lucide-react";
import Link from "next/link";
import { initials, shortName, type UpcomingBirthday } from "@/lib/dashboard-brief";

/**
 * Quiet right-rail context for the dashboard: a small daily brief (the PRD's 1–3
 * timely things) over real signals only, plus fast people recall. No closeness
 * scores, no vanity metrics, no infrastructure — just who might need a thought
 * today and a way to jump to anyone.
 */
export function TodayRail({
  people,
  birthdays,
  pendingReviewCount,
}: {
  people: Person[];
  birthdays: UpcomingBirthday[];
  pendingReviewCount: number;
}) {
  const hasBrief = birthdays.length > 0 || pendingReviewCount > 0;

  return (
    <aside className="flex flex-col gap-6">
      <section className="flex flex-col gap-2.5">
        <RailHeading>Today</RailHeading>
        <div className="overflow-hidden rounded-xl border bg-surface">
          {hasBrief ? (
            <ul className="divide-y">
              {birthdays.map((birthday) => (
                <BirthdayRow birthday={birthday} key={birthday.person.id} />
              ))}
              {pendingReviewCount > 0 ? <ReviewRow count={pendingReviewCount} /> : null}
            </ul>
          ) : (
            <p className="px-4 py-4 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              Nothing needs you today. A good moment to jot down anything you want to remember.
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <RailHeading>People</RailHeading>
          <Link
            className="text-[length:var(--text-small)] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            href="/people"
          >
            All
          </Link>
        </div>
        <div className="overflow-hidden rounded-xl border bg-surface">
          {people.length > 0 ? (
            <ul className="divide-y">
              {people.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              No people yet. Capture someone and they'll show up here.
            </p>
          )}
        </div>
      </section>
    </aside>
  );
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-[length:var(--text-small)] font-medium text-muted-foreground">
      {children}
    </h2>
  );
}

function BirthdayRow({ birthday }: { birthday: UpcomingBirthday }) {
  const { person, label } = birthday;

  return (
    <li>
      <Link
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-panel"
        href={`/people/${person.id}`}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-soft-foreground"
        >
          <CakeIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{shortName(person)}'s birthday</span>
          <span className="block text-[length:var(--text-small)] text-muted-foreground">
            {label}
          </span>
        </span>
      </Link>
    </li>
  );
}

function ReviewRow({ count }: { count: number }) {
  return (
    <li>
      <a
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-panel"
        href="#assistant"
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground"
        >
          <InboxIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {count} {count === 1 ? "capture" : "captures"} ready to review
          </span>
          <span className="block text-[length:var(--text-small)] text-muted-foreground">
            Saved before becoming memory
          </span>
        </span>
      </a>
    </li>
  );
}

function PersonRow({ person }: { person: Person }) {
  return (
    <li>
      <Link
        className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-panel"
        href={`/people/${person.id}`}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[length:var(--text-small)] font-medium text-primary"
        >
          {initials(person.displayName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{person.displayName}</span>
          <span className="block truncate text-[length:var(--text-small)] text-muted-foreground capitalize">
            {person.relationshipType}
          </span>
        </span>
        <ArrowRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </Link>
    </li>
  );
}
