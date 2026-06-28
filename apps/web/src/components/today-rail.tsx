import type { Person } from "@tendnote/domain";
import { ArrowRightIcon, CakeIcon } from "lucide-react";
import Link from "next/link";
import { DashboardBriefSection } from "@/components/dashboard-brief-section";
import { DashboardFollowupsSection } from "@/components/dashboard-followups-section";
import {
  DashboardReviewSection,
  type DashboardReviewView,
} from "@/components/dashboard-review-section";
import { DashboardSuggestedFollowupsSection } from "@/components/dashboard-suggested-followups-section";
import type { BriefView } from "@/lib/brief-view";
import { initials, shortName, type UpcomingBirthday } from "@/lib/dashboard-brief";
import type { DashboardFollowupView } from "@/lib/followup-view";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

/**
 * Quiet right-rail context for the dashboard: a small daily brief (the PRD's 1–3
 * timely things) over real signals only, the open suggested-memory reviews
 * awaiting an approve/dismiss, plus fast people recall. No closeness scores, no
 * vanity metrics, no infrastructure — just what needs a thought today, what's
 * waiting on the user, and a way to jump to anyone.
 */
export function TodayRail({
  people,
  birthdays,
  followups,
  followupReviews,
  reviews,
  dailyBrief,
  weeklyBrief,
}: {
  people: Person[];
  birthdays: UpcomingBirthday[];
  followups: DashboardFollowupView[];
  followupReviews: SuggestedFollowupReviewView[];
  reviews: DashboardReviewView[];
  dailyBrief: BriefView | null;
  weeklyBrief: BriefView | null;
}) {
  return (
    <aside className="flex flex-col gap-6">
      {/* Persisted briefs lead the rail: the current daily brief first, then the
          weekly relationship review (PRD #65, issue #70). Keying on the brief id
          remounts the section when a brief is generated or regenerated (so new
          items appear after revalidation), while dismiss/snooze keep their
          optimistic state because the id is unchanged. */}
      <DashboardBriefSection brief={dailyBrief} cadence="daily" key={dailyBrief?.id ?? "daily"} />
      <DashboardBriefSection
        brief={weeklyBrief}
        cadence="weekly"
        key={weeklyBrief?.id ?? "weekly"}
      />

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

      <DashboardFollowupsSection initialFollowups={followups} />

      <DashboardSuggestedFollowupsSection initialReviews={followupReviews} />

      <DashboardReviewSection initialReviews={reviews} />

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
