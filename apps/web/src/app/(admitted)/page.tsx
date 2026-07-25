import { getCurrentBrief } from "@tendnote/db/queries/briefs";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import type { BriefCadence, TodayShortlistResponse } from "@tendnote/domain";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  actOnTodayItemAction,
  refreshTodayAction,
  suppressTodayItemAction,
} from "@/app/actions/today";
import { DashboardAssistant } from "@/components/dashboard-assistant";
import { DashboardFrame } from "@/components/dashboard-frame";
import { DashboardGreeting } from "@/components/dashboard-greeting";
import { DashboardRail } from "@/components/dashboard-rail";
import {
  DashboardAssistantReserve,
  DashboardGreetingReserve,
  DashboardRailReserve,
} from "@/components/dashboard-reserve";
import { MobileHomeReserve } from "@/components/mobile-home-reserve";
import { MobileTodayDestination } from "@/components/mobile-today-destination";
import { ReviewQueueFamilySection } from "@/components/review-queue-section";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { currentLocalDate } from "@/lib/brief-local-date";
import { type BriefView, toBriefView } from "@/lib/brief-view";
import {
  getCachedReviewQueueFamily,
  getCachedTodayShortlist,
} from "@/lib/cache/today-review-views";
import { toCalendarSuggestionReviewView } from "@/lib/calendar-suggestion-review-view";
import { getUpcomingBirthdays } from "@/lib/dashboard-brief";
import {
  dashboardActiveFollowups,
  dashboardAssistantHints,
  dashboardCalendarSuggestions,
  dashboardPeople,
  dashboardSuggestedFollowups,
} from "@/lib/dashboard-context";
import { toDashboardFollowupView } from "@/lib/followup-view";
import type { ReviewQueueFamily } from "@/lib/review-queue";
import { toSuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

type HomeTab = "today" | "review";
type HomeProps = { searchParams?: Promise<{ tab?: string }> };

async function homeTab(searchParams: HomeProps["searchParams"]): Promise<HomeTab> {
  return (await searchParams)?.tab === "review" ? "review" : "today";
}

/**
 * Every streamed region keeps its own exact admission gate, so each one has to
 * name the URL the owner comes back to — including the tab they were on, since
 * whichever region resolves first is the one that redirects.
 */
function admittedHomeOwner(tab: HomeTab): Promise<string> {
  return requireAdmittedOwner({ returnTo: tab === "review" ? "/?tab=review" : "/" });
}

/**
 * Home is one destination with two rail tabs, not two destinations. Nothing in
 * this component reads the request, so the whole canvas — greeting slot,
 * assistant column, and rail tab bar — belongs to the static shell and is on
 * screen before the first owner-scoped read resolves. Each region below streams
 * independently behind a reserve shaped like itself, and switching Today↔Review
 * moves nothing: it selects a rail panel that is already there.
 */
export default function Home(props: HomeProps) {
  return (
    <>
      {/* Narrow viewports get the focused Today (or Review) destination, which
          owns its own canvas — `data-mobile-bleed` tells the shell not to pad it. */}
      <div className="lg:hidden" data-mobile-bleed>
        <Suspense fallback={<MobileHomeReserve />}>
          <HomeMobileDestination searchParams={props.searchParams} />
        </Suspense>
      </div>

      <div className="hidden lg:contents">
        <DashboardFrame
          assistant={
            <Suspense fallback={<DashboardAssistantReserve />}>
              <HomeAssistant searchParams={props.searchParams} />
            </Suspense>
          }
          greeting={
            <Suspense fallback={<DashboardGreetingReserve />}>
              <HomeGreeting />
            </Suspense>
          }
          rail={
            <Suspense fallback={<DashboardRailReserve />}>
              <HomeRail searchParams={props.searchParams} />
            </Suspense>
          }
        />
      </div>
    </>
  );
}

/**
 * The greeting reads the server clock, so it is request-bound and streams into
 * the reserve that holds its two lines. It is deliberately its own boundary: a
 * time-of-day heading must never make the assistant wait.
 */
async function HomeGreeting() {
  if (process.env.NODE_ENV !== "test") await connection();
  return <DashboardGreeting />;
}

/**
 * The assistant needs the owner's id for its on-device draft key, and two purely
 * cosmetic hints: the Calendar-derived prompt nudges and a real name for the
 * composer placeholder. Both come from reads this destination already performs
 * for the rail, memoised per request — so putting the assistant on screen costs
 * no extra query and starts no conversation.
 */
async function HomeAssistant({ searchParams }: HomeProps) {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await admittedHomeOwner(await homeTab(searchParams));
  const hints = await dashboardAssistantHints(ownerUserId);

  return (
    <DashboardAssistant
      nudges={hints.nudges}
      ownerUserId={ownerUserId}
      suggestPersonName={hints.suggestPersonName}
    />
  );
}

/**
 * Every rail tab is served on both URLs. The tab is a view over data the owner
 * already has, so `?tab=review` selects a panel rather than swapping the
 * composition — which is what kept Follow-ups and People from reading as empty
 * whenever Review was the entry point.
 */
async function HomeRail({ searchParams }: HomeProps) {
  if (process.env.NODE_ENV !== "test") await connection();
  const tab = await homeTab(searchParams);
  const ownerUserId = await admittedHomeOwner(tab);
  const [people, followups, followupReviews, calendarSuggestions, dailyBrief, weeklyBrief] =
    await Promise.all([
      dashboardPeople(ownerUserId),
      dashboardActiveFollowups(ownerUserId),
      dashboardSuggestedFollowups(ownerUserId),
      dashboardCalendarSuggestions(ownerUserId),
      getDashboardBrief(ownerUserId, "daily"),
      getDashboardBrief(ownerUserId, "weekly"),
    ]);

  return (
    <DashboardRail
      birthdays={getUpcomingBirthdays(people)}
      calendarSuggestions={calendarSuggestions.map((suggestion) =>
        toCalendarSuggestionReviewView(suggestion),
      )}
      dailyBrief={dailyBrief}
      followupReviews={followupReviews.map((review) => toSuggestedFollowupReviewView(review))}
      followups={followups.map((summary) => toDashboardFollowupView(summary))}
      initialTab={tab}
      people={people}
      reviewContent={<ReviewQueueStreams ownerUserId={ownerUserId} />}
      reviewQueue={{ count: 0, failures: [], items: [] }}
      weeklyBrief={weeklyBrief}
    />
  );
}

const REVIEW_FAMILIES: { family: ReviewQueueFamily; heading: string }[] = [
  { family: "suggested-memory", heading: "Memories" },
  { family: "suggested-general-action", heading: "Actions" },
  { family: "asset-review-group", heading: "Assets" },
  { family: "source-record", heading: "Source details" },
];

function ReviewQueueStreams({ ownerUserId }: { ownerUserId: string }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-pretty px-1 text-[length:var(--text-small)] text-muted-foreground">
        Suggestions appear here as they are ready.
      </p>
      {REVIEW_FAMILIES.map(({ family, heading }) => (
        <Suspense fallback={<ReviewFamilyReserve heading={heading} />} key={family}>
          <ReviewQueueFamilyStream family={family} heading={heading} ownerUserId={ownerUserId} />
        </Suspense>
      ))}
    </div>
  );
}

async function ReviewQueueFamilyStream({
  family,
  heading,
  ownerUserId,
}: {
  family: ReviewQueueFamily;
  heading: string;
  ownerUserId: string;
}) {
  const result = await getCachedReviewQueueFamily(ownerUserId, family);
  if (result.unavailable) {
    return (
      <section className="rounded-xl border bg-muted/40 px-4 py-4">
        <h2 className="font-medium text-[length:var(--text-small)] text-muted-foreground">
          {heading}
        </h2>
        <p className="mt-1 text-[length:var(--text-small)] text-muted-foreground">
          This review group is temporarily unavailable. Your records are unchanged.
        </p>
      </section>
    );
  }
  if (result.items.length === 0) return null;
  return <ReviewQueueFamilySection heading={heading} initialItems={result.items} />;
}

function ReviewFamilyReserve({ heading }: { heading: string }) {
  return (
    <section aria-busy="true" aria-label={`Loading ${heading}`} className="flex flex-col gap-2">
      <h2 className="px-1 font-medium text-[length:var(--text-small)] text-muted-foreground">
        {heading}
      </h2>
      <div className="h-20 animate-pulse rounded-xl border bg-muted/40" />
    </section>
  );
}

/** The narrow-viewport destination: the focused Today surface, or the Review list. */
async function HomeMobileDestination({ searchParams }: HomeProps) {
  if (process.env.NODE_ENV !== "test") await connection();
  const tab = await homeTab(searchParams);
  const ownerUserId = await admittedHomeOwner(tab);

  if (tab === "review") {
    return (
      <div className="flex flex-col gap-6 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-semibold text-[length:var(--text-h1)] leading-[var(--text-h1-line)]">
            Review
          </h1>
        </header>
        <ReviewQueueStreams ownerUserId={ownerUserId} />
      </div>
    );
  }

  const todayContext = await getOwnerTodayContext({ ownerUserId });

  return (
    <MobileTodayDestination
      ownerUserId={ownerUserId}
      todayHandlers={{
        act: actOnTodayItemAction,
        refresh: refreshTodayAction,
        suppress: suppressTodayItemAction,
      }}
      todayInitial={await getHomeToday(ownerUserId, todayContext)}
      todayLocalDate={todayContext.localDate}
      todayTimeZone={todayContext.timeZone}
    />
  );
}

async function getHomeToday(
  ownerUserId: string,
  context: { localDate: string; timeZone: string; now: Date },
): Promise<TodayShortlistResponse> {
  try {
    return await getCachedTodayShortlist({ ownerUserId, ...context });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.warn("Unable to load Today.", error);
    return {
      items: [],
      candidateFingerprint: "",
      curation: "deterministic_fallback",
      overflow: null,
      limitations: ["Today is temporarily unavailable. Your records are unchanged."],
    };
  }
}

async function getDashboardBrief(
  ownerUserId: string,
  cadence: BriefCadence,
): Promise<BriefView | null> {
  try {
    // Render the current persisted brief from stored snapshots — never a live
    // relationship-agenda recomputation (PRD #65, issue #70).
    const brief = await getCurrentBrief({ ownerUserId, cadence, localDate: currentLocalDate() });
    return brief ? toBriefView(brief) : null;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Unable to load the ${cadence} brief.`, error);
    }

    return null;
  }
}
