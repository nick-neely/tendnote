import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import type { BriefCadence, TodayShortlistResponse } from "@tendnote/domain";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  actOnTodayItemAction,
  refreshTodayAction,
  restoreTodayItemAction,
  suppressTodayItemAction,
} from "@/app/actions/today";
import {
  SelfContextHomeInvitation,
  type SelfContextHomeInvitationProps,
} from "@/components/account/self-context-home-invitation";
import {
  appDestination,
  explicitHomePanelForLocation,
  type HomePanel,
  homePanelForLocation,
} from "@/components/app-destinations";
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
import { EmptyState } from "@/components/ui/empty-state";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { currentLocalDate } from "@/lib/brief-local-date";
import type { BriefView } from "@/lib/brief-view";
import { getCachedCurrentBriefView } from "@/lib/cache/brief-views";
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
  dashboardNextFollowupBeyondHorizon,
  dashboardPeople,
  dashboardSuggestedFollowups,
} from "@/lib/dashboard-context";
import { toDashboardFollowupView } from "@/lib/followup-view";
import { defaultRailTab } from "@/lib/rail-tabs";
import type { ReviewQueueFamily } from "@/lib/review-queue";
import { toSuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

type HomeProps = SelfContextHomeInvitationProps;

async function homeSearchParams(searchParams: HomeProps["searchParams"]): Promise<URLSearchParams> {
  const params = new URLSearchParams();
  const tab = (await searchParams)?.tab;
  if (tab) params.set("tab", tab);
  return params;
}

async function homeTab(searchParams: HomeProps["searchParams"]): Promise<HomePanel> {
  return homePanelForLocation("/", await homeSearchParams(searchParams));
}

/**
 * Every streamed region keeps its own exact admission gate, so each one has to
 * name the URL the owner comes back to — including the tab they were on, since
 * whichever region resolves first is the one that redirects.
 */
function admittedHomeOwner(tab: HomePanel): Promise<string> {
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
      <Suspense fallback={null}>
        <SelfContextHomeInvitation searchParams={props.searchParams} />
      </Suspense>
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
  const urlPanel = explicitHomePanelForLocation("/", await homeSearchParams(searchParams));
  const ownerUserId = await admittedHomeOwner(urlPanel ?? "today");
  const [
    people,
    followups,
    nextFollowup,
    followupReviews,
    calendarSuggestions,
    dailyBrief,
    weeklyBrief,
    reviewCount,
  ] = await Promise.all([
    dashboardPeople(ownerUserId),
    dashboardActiveFollowups(ownerUserId),
    dashboardNextFollowupBeyondHorizon(ownerUserId),
    dashboardSuggestedFollowups(ownerUserId),
    dashboardCalendarSuggestions(ownerUserId),
    getDashboardBrief(ownerUserId, "daily"),
    getDashboardBrief(ownerUserId, "weekly"),
    countOwnerReviewQueue(ownerUserId),
  ]);
  const now = new Date();
  const birthdays = getUpcomingBirthdays(people);

  return (
    <DashboardRail
      birthdays={birthdays}
      calendarSuggestions={calendarSuggestions.map((suggestion) =>
        toCalendarSuggestionReviewView(suggestion),
      )}
      dailyBrief={dailyBrief}
      followupReviews={followupReviews.map((review) => toSuggestedFollowupReviewView(review))}
      followups={followups.map((summary) => toDashboardFollowupView(summary, now, ownerUserId))}
      initialTab={landingRailTab({
        birthdays,
        calendarSuggestions,
        dailyBrief,
        followupReviews,
        followups,
        reviewCount,
        urlPanel,
      })}
      nextFollowup={nextFollowup ? toDashboardFollowupView(nextFollowup, now, ownerUserId) : null}
      people={people}
      reviewContent={<ReviewQueueStreams ownerUserId={ownerUserId} />}
      reviewCount={reviewCount}
      weeklyBrief={weeklyBrief}
    />
  );
}

/**
 * Which panel the rail opens on - the whole rule, so it can only be answered one
 * way. A URL that names a panel always wins; otherwise `defaultRailTab` picks the
 * first one holding something.
 *
 * The counting lives here rather than in `defaultRailTab` because it is the part
 * that has to agree with what each panel actually lists: Today counts birthdays
 * plus brief items, and Follow-ups counts the reminders, the suggestions, and the
 * calendar proposals it shows together. Keep them in step and the rail can never
 * open on a panel that then renders empty.
 */
function landingRailTab({
  birthdays,
  calendarSuggestions,
  dailyBrief,
  followupReviews,
  followups,
  reviewCount,
  urlPanel,
}: {
  birthdays: ReturnType<typeof getUpcomingBirthdays>;
  calendarSuggestions: Awaited<ReturnType<typeof dashboardCalendarSuggestions>>;
  dailyBrief: Awaited<ReturnType<typeof getDashboardBrief>>;
  followupReviews: Awaited<ReturnType<typeof dashboardSuggestedFollowups>>;
  followups: Awaited<ReturnType<typeof dashboardActiveFollowups>>;
  reviewCount: number;
  /** The panel the URL asked for, when it asked for one. */
  urlPanel: HomePanel | null;
}) {
  return (
    urlPanel ??
    defaultRailTab({
      today: birthdays.length + (dailyBrief?.items.length ?? 0),
      followups: followups.length + followupReviews.length + calendarSuggestions.length,
      review: reviewCount,
    })
  );
}

/**
 * How many items are waiting in Review, for the tab's count and for the rail's
 * content-aware landing panel.
 *
 * The families still stream into the panel one by one; this read only asks how
 * many there are. It costs nothing extra: the per-family reads are cached, so the
 * streamed sections below hit the same entries rather than querying twice. The
 * count has to be known before the rail renders, because a panel that changed
 * under the owner once the streams arrived would be worse than no default at all.
 */
async function countOwnerReviewQueue(ownerUserId: string): Promise<number> {
  const families = await Promise.all(
    REVIEW_FAMILIES.map(({ family }) => getCachedReviewQueueFamily(ownerUserId, family)),
  );
  return families.reduce((total, result) => total + result.items.length, 0);
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
      {/* The teaching empty state sits behind its own boundary: it has to read
          every family to know the queue is empty, and that must not hold up a
          queue that has something in it. Each family below still streams alone,
          and an empty one renders nothing, so only one of the two ever shows. */}
      <Suspense fallback={null}>
        <ReviewQueueEmpty ownerUserId={ownerUserId} />
      </Suspense>
      {REVIEW_FAMILIES.map(({ family, heading }) => (
        <Suspense fallback={<ReviewFamilyReserve heading={heading} />} key={family}>
          <ReviewQueueFamilyStream family={family} heading={heading} ownerUserId={ownerUserId} />
        </Suspense>
      ))}
    </div>
  );
}

/** Same words as the rail's Review tab: what lands here, and who says yes to it. */
async function ReviewQueueEmpty({ ownerUserId }: { ownerUserId: string }) {
  if ((await countOwnerReviewQueue(ownerUserId)) > 0) return null;

  return (
    <EmptyState
      description="Eve's suggestions land here first: a detail worth keeping, an action to take, a name it couldn't place. Nothing is saved without your yes."
      size="compact"
      title="Nothing waiting to review."
    />
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
            {appDestination("review").label}
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
        restore: restoreTodayItemAction,
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
    return await getCachedCurrentBriefView({
      ownerUserId,
      cadence,
      localDate: currentLocalDate(),
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Unable to load the ${cadence} brief.`, error);
    }

    return null;
  }
}
