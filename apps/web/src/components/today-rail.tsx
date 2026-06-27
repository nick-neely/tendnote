import type { Person } from "@tendnote/domain";
import { ArrowRightIcon, CakeIcon } from "lucide-react";
import Link from "next/link";
import { initials, shortName, type UpcomingBirthday } from "@/lib/dashboard-brief";
import type { SourceRecordReviewView } from "@/lib/source-record-review-view";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual note",
  agent: "Assistant note",
  seed: "Sample note",
  contact_import: "Imported contact",
  calendar: "Calendar",
  gmail: "Email",
};

function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? `${sourceType} context`;
}

function formatCaptured(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Quiet right-rail context for the dashboard: a small daily brief (the PRD's 1–3
 * timely things) over real signals only, the pending capture inbox, plus fast
 * people recall. No closeness scores, no vanity metrics, no infrastructure —
 * just who might need a thought today and a way to jump to anyone.
 */
export function TodayRail({
  people,
  birthdays,
  reviews,
}: {
  people: Person[];
  birthdays: UpcomingBirthday[];
  reviews: SourceRecordReviewView[];
}) {
  return (
    <aside className="flex flex-col gap-6">
      <section className="flex flex-col gap-2.5">
        <RailHeading>Today</RailHeading>
        <div className="overflow-hidden rounded-xl border bg-surface">
          {birthdays.length > 0 ? (
            <ul className="divide-y">
              {birthdays.map((birthday) => (
                <BirthdayRow birthday={birthday} key={birthday.person.id} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              Nothing needs you today. A good moment to jot down anything you want to remember.
            </p>
          )}
        </div>
      </section>

      {reviews.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <RailHeading>Ready to review</RailHeading>
          <div className="overflow-hidden rounded-xl border bg-surface">
            <ul className="divide-y">
              {reviews.map((review) => (
                <ReviewRow key={review.sourceRecord.id} review={review} />
              ))}
            </ul>
          </div>
        </section>
      ) : null}

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

/** A saved capture awaiting confirmation into memory — the pending inbox. */
function ReviewRow({ review }: { review: SourceRecordReviewView }) {
  const { sourceRecord } = review;

  return (
    <li
      className="flex flex-col gap-2 px-4 py-3"
      data-source-record-id={review.component.sourceRecordId}
    >
      <p className="line-clamp-2 text-pretty text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {sourceRecord.content}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          Ready to review
        </span>
        <span className="truncate font-mono text-[length:var(--text-caption)] text-muted-foreground">
          {sourceLabel(sourceRecord.sourceType)} · {formatCaptured(sourceRecord.createdAt)}
        </span>
      </div>
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
