"use client";

import type { Person } from "@tendnote/domain";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { homePanelForLocation } from "@/components/app-destinations";
import { DashboardBriefSection } from "@/components/dashboard-brief-section";
import { DashboardCalendarSuggestionsSection } from "@/components/dashboard-calendar-suggestions-section";
import { DashboardFollowupsSection } from "@/components/dashboard-followups-section";
import { DashboardSuggestedFollowupsSection } from "@/components/dashboard-suggested-followups-section";
import { ArrowRightIcon, CakeIcon } from "@/components/icons";
import { ReviewQueueSection } from "@/components/review-queue-section";
import { TabCount } from "@/components/tab-count";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BriefView } from "@/lib/brief-view";
import type { CalendarSuggestionReviewView } from "@/lib/calendar-suggestion-review-view";
import { initials, shortName, type UpcomingBirthday } from "@/lib/dashboard-brief";
import type { DashboardFollowupView } from "@/lib/followup-view";
import {
  type ReviewQueue,
  type ReviewQueueIdentity,
  type ReviewQueueItem,
  resolveReviewQueueItem,
  updateReviewQueueItem,
} from "@/lib/review-queue";
import type { SuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

// Inactive panels stay mounted (forceMount) so a panel keeps its scroll position
// and any in-flight optimistic state when you tab away and back; only the active
// one is laid out. Each panel scrolls inside itself on desktop (the rail column
// is height-bounded) and flows normally on mobile.
const PANEL =
  "data-[state=inactive]:hidden data-[state=active]:flex flex-col gap-6 min-h-0 pb-1 lg:overflow-y-auto lg:pr-2";

/** The two panels a Home URL can name, and the full set the rail offers. */
type RailTab = "today" | "review" | "followups" | "people";

/**
 * The dashboard's right-hand context panel: a tabbed gutter beside the assistant
 * chat (issue: rethink the long single-scroll rail). The chat stays the first-
 * class working column; this panel keeps everything else in its own place rather
 * than buried in one ever-growing scroll.
 *
 * Each tab owns its content exclusively — nothing is duplicated across tabs, so
 * no single area bloats. Today (the morning glance: today's signals plus the
 * daily and weekly briefs, which have no tab of their own), Follow-ups (active
 * reminders + suggested follow-ups), Review (the shared Review Queue: suggested
 * memories, Suggested actions, and grouped Asset review, ADRs 0152/0191), and
 * People (fast recall). The rail owns the mutable collections so a calm, neutral count on the
 * Follow-ups and Review tabs stays in sync as items resolve — nothing is hidden
 * behind a click without a count, and the inline approve/dismiss is preserved so
 * no one has to open a person page just to clear a suggestion. Counts are never
 * red and never framed as a backlog; an empty tab teaches the next step instead
 * of nagging.
 */
// The cohesive tab shell that owns the follow-up lists, unified Review Queue, and live counts; the
// per-section markup is already extracted into child sections. Its score is JSX/tab
// composition depth plus that list-state hook set, not branching logic (cyclomatic and
// cognitive are both within threshold); splitting the shell further would scatter the
// count-syncing state that keeps the tabs honest.
// fallow-ignore-next-line complexity
export function DashboardRail({
  people,
  birthdays,
  followups: initialFollowups,
  followupReviews: initialFollowupReviews,
  calendarSuggestions: initialCalendarSuggestions,
  reviewQueue: initialReviewQueue,
  dailyBrief,
  weeklyBrief,
  reviewContent,
  initialTab = "today",
}: {
  people: Person[];
  birthdays: UpcomingBirthday[];
  followups: DashboardFollowupView[];
  followupReviews: SuggestedFollowupReviewView[];
  calendarSuggestions: CalendarSuggestionReviewView[];
  reviewQueue: ReviewQueue;
  dailyBrief: BriefView | null;
  weeklyBrief: BriefView | null;
  reviewContent?: ReactNode;
  initialTab?: RailTab;
}) {
  // The destination module resolves the two panels a URL can express:
  // arriving from anywhere — a nav link, the narrow-viewport Review destination, a
  // shared link — selects the panel that URL names. Follow-ups and People have no
  // URL of their own, so picking one is purely local and leaves the URL alone.
  const urlTab = homePanelForLocation("/", useSearchParams());
  const [activeTab, setActiveTab] = useState<RailTab>(initialTab);
  const [followups, setFollowups] = useState(initialFollowups);
  const [suggestedFollowups, setSuggestedFollowups] = useState(initialFollowupReviews);
  const [calendarSuggestions, setCalendarSuggestions] = useState(initialCalendarSuggestions);
  const [reviewQueue, setReviewQueue] = useState(initialReviewQueue);

  const resolveFollowup = (id: string) =>
    setFollowups((current) => current.filter((followup) => followup.id !== id));
  const resolveSuggestedFollowup = (id: string) =>
    setSuggestedFollowups((current) => current.filter((review) => review.followup.id !== id));
  const resolveCalendarSuggestion = (id: string) =>
    setCalendarSuggestions((current) => current.filter((suggestion) => suggestion.id !== id));
  const resolveReview = (identity: ReviewQueueIdentity) =>
    setReviewQueue((current) => resolveReviewQueueItem(current, identity));
  const updateReview = (item: ReviewQueueItem) =>
    setReviewQueue((current) => updateReviewQueueItem(current, item));

  const followupCount = followups.length + suggestedFollowups.length + calendarSuggestions.length;

  // Fresh server data replaces the optimistic collections, but it must not move
  // the owner: a background refresh after a mutation would otherwise snap them
  // back to whichever tab the URL named.
  useEffect(() => {
    setFollowups(initialFollowups);
    setSuggestedFollowups(initialFollowupReviews);
    setCalendarSuggestions(initialCalendarSuggestions);
    setReviewQueue(initialReviewQueue);
  }, [initialCalendarSuggestions, initialFollowupReviews, initialFollowups, initialReviewQueue]);

  // A nav link back to Home, a Review deep link, or Back takes the rail with it.
  // Local picks do not mutate the URL, so a data refresh cannot eject the owner
  // from the panel they are using.
  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  function selectTab(tab: RailTab) {
    setActiveTab(tab);
  }

  return (
    <Tabs
      className="flex min-h-0 flex-col gap-3 lg:h-full"
      onValueChange={(value) => selectTab(value as RailTab)}
      value={activeTab}
    >
      <TabsList className="w-full shrink-0">
        <TabsTrigger className="group/tab" value="today">
          Today
        </TabsTrigger>
        <TabsTrigger className="group/tab" value="followups">
          Follow-ups
          <TabCount count={followupCount} />
        </TabsTrigger>
        <TabsTrigger className="group/tab" value="review">
          Review
          <TabCount count={reviewQueue.count} />
        </TabsTrigger>
        <TabsTrigger className="group/tab" value="people">
          People
        </TabsTrigger>
      </TabsList>

      {/* Today — the morning glance: today's signals, then the briefs. The
          briefs live only here; they have no tab of their own. */}
      <TabsContent className={PANEL} value="today">
        {birthdays.length > 0 ? <BirthdaysSection birthdays={birthdays} /> : null}

        {/* Persisted briefs: the current daily brief, then the weekly review (PRD
            #65). Keying on the brief id remounts on (re)generation so new items
            appear, while dismiss/snooze keep their optimistic state. */}
        <DashboardBriefSection brief={dailyBrief} cadence="daily" key={dailyBrief?.id ?? "daily"} />
        <DashboardBriefSection
          brief={weeklyBrief}
          cadence="weekly"
          key={weeklyBrief?.id ?? "weekly"}
        />
      </TabsContent>

      {/* Follow-ups — active reminders, then suggestions awaiting a yes/no. */}
      <TabsContent className={PANEL} value="followups">
        {followupCount === 0 ? (
          <RailEmpty>
            No follow-ups right now. Reminders you set, and ones Eve suggests, show up here.
          </RailEmpty>
        ) : (
          <>
            <DashboardFollowupsSection
              fallbackFocusTarget={() =>
                document.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
              }
              followups={followups}
              heading="Reminders"
              onResolve={resolveFollowup}
            />
            <DashboardSuggestedFollowupsSection
              fallbackFocusTarget={() =>
                document.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
              }
              heading="Suggested"
              onResolve={resolveSuggestedFollowup}
              reviews={suggestedFollowups}
            />
            <DashboardCalendarSuggestionsSection
              onResolve={resolveCalendarSuggestion}
              suggestions={calendarSuggestions}
            />
          </>
        )}
      </TabsContent>

      {/* Review — the shared Review Queue: suggested memories and Suggested actions,
          each accepted or set aside in place (ADR 0152). */}
      <TabsContent className={PANEL} value="review">
        {reviewContent ? (
          reviewContent
        ) : reviewQueue.count === 0 ? (
          <RailEmpty>
            Nothing waiting to review. Eve's suggestions land here first: things to remember,
            actions to take, and assets to track.
          </RailEmpty>
        ) : (
          <ReviewQueueSection
            items={reviewQueue.items}
            onResolve={resolveReview}
            onUpdate={updateReview}
          />
        )}
      </TabsContent>

      {/* People — fast recall, full to the person pages. */}
      <TabsContent className={PANEL} value="people">
        <PeopleSection people={people} />
      </TabsContent>
    </Tabs>
  );
}

function RailEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <p className="text-pretty px-4 py-4 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        {children}
      </p>
    </div>
  );
}

function BirthdaysSection({ birthdays }: { birthdays: UpcomingBirthday[] }) {
  return (
    <section className="flex flex-col gap-2.5">
      <RailHeading>Today</RailHeading>
      <div className="overflow-hidden rounded-xl border bg-surface">
        <ul className="divide-y">
          {birthdays.map((birthday) => (
            <BirthdayRow birthday={birthday} key={birthday.person.id} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function PeopleSection({ people }: { people: Person[] }) {
  return (
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
  );
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 font-medium text-[length:var(--text-small)] text-muted-foreground">
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
          <span className="block truncate font-medium text-sm">{shortName(person)}'s birthday</span>
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
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 font-medium text-[length:var(--text-small)] text-primary"
        >
          {initials(person.displayName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{person.displayName}</span>
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
