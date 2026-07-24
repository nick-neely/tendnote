import { getCurrentBrief } from "@tendnote/db/queries/briefs";
import { listCalendarSuggestedFollowups } from "@tendnote/db/queries/calendar-followups";
import { listActiveFollowups, listSuggestedFollowupReviews } from "@tendnote/db/queries/followups";
import { searchPeople } from "@tendnote/db/queries/people";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import type { BriefCadence, TodayShortlistResponse } from "@tendnote/domain";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  actOnTodayItemAction,
  refreshTodayAction,
  suppressTodayItemAction,
} from "@/app/actions/today";
import { AccessCheckFallback } from "@/components/access-check-fallback";
import { AdmittedRoute } from "@/components/admitted-route";
import { AssistantPanel } from "@/components/assistant-panel";
import { DashboardGreeting } from "@/components/dashboard-greeting";
import { DashboardRail } from "@/components/dashboard-rail";
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
import { suggestComposerPerson } from "@/lib/composer-suggestion";
import { getUpcomingBirthdays } from "@/lib/dashboard-brief";
import { toDashboardFollowupView } from "@/lib/followup-view";
import { getOwnerCalendarPromptNudges } from "@/lib/integrations/calendar-prompt-nudges";
import type { ReviewQueueFamily } from "@/lib/review-queue";
import { toSuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

// A handful of the soonest active reminders — a calm prompt, not a task feed (#45).
const DASHBOARD_FOLLOWUP_LIMIT = 5;

type HomeProps = { searchParams?: Promise<{ tab?: string }> };

export default function Home(props: HomeProps) {
  return (
    <Suspense fallback={<AccessCheckFallback />}>
      <HomeRoute {...props} />
    </Suspense>
  );
}

async function HomeRoute({ searchParams }: HomeProps) {
  const requestedTab = (await searchParams)?.tab;
  const isReview = requestedTab === "review";
  return (
    <AdmittedRoute
      mobileDestination={isReview ? undefined : <HomeMobileContent />}
      mobileHome={!isReview}
      mobileReview={isReview}
      returnTo={isReview ? "/?tab=review" : "/"}
      title={isReview ? "Review" : "Today"}
    >
      <HomeContent requestedTab={requestedTab} />
    </AdmittedRoute>
  );
}

async function HomeContent({ requestedTab }: { requestedTab?: string }) {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({
    returnTo: requestedTab === "review" ? "/?tab=review" : "/",
  });
  const selectedTab = requestedTab === "review" ? "review" : "today";

  return (
    <>
      {/* On desktop the dashboard fills the viewport and does not scroll itself
          (100dvh − 3.5rem header − 4rem main padding); the chat and the rail each
          scroll inside their own column instead of growing the page. */}
      <div className="flex flex-col gap-6 lg:h-[calc(100dvh-7.5rem)] lg:gap-8 lg:overflow-hidden">
        <DashboardGreeting />

        {/* grid-rows minmax(0,1fr) makes the single row fill the bounded grid
            height; without it the row is auto-sized to content and the chat
            column grows past the viewport instead of scrolling inside itself.
            On mobile the assistant leads (order-1) so the chat sits at the top
            under the greeting rather than buried beneath the rail; on desktop it
            stays the left content column with the tabbed rail on the right. The
            rail widens a touch from lg→xl so its tabs and cards keep room. */}
        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
          {selectedTab === "today" ? (
            <div className="order-1 h-[70dvh] lg:h-full lg:min-h-0">
              <Suspense
                fallback={<div className="h-full animate-pulse rounded-xl border bg-muted/40" />}
              >
                <HomeAssistant ownerUserId={ownerUserId} />
              </Suspense>
            </div>
          ) : (
            <div className="order-1 hidden lg:block" aria-hidden />
          )}
          {/* The rail manages its own scroll inside the active tab panel (the tab
              bar stays pinned), so the column itself is only height-bounded. */}
          <div className="order-2 lg:h-full lg:min-h-0">
            <Suspense
              fallback={<div className="h-full animate-pulse rounded-xl border bg-muted/40" />}
            >
              <HomeRail ownerUserId={ownerUserId} selectedTab={selectedTab} />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}

async function HomeAssistant({ ownerUserId }: { ownerUserId: string }) {
  const [people, followups, nudges] = await Promise.all([
    searchPeople({ ownerUserId, limit: 8 }),
    getDashboardFollowups(ownerUserId),
    getOwnerCalendarPromptNudges(),
  ]);

  return (
    <AssistantPanel
      nudges={nudges}
      ownerUserId={ownerUserId}
      suggestPersonName={suggestComposerPerson(followups, people)}
    />
  );
}

async function HomeRail({
  ownerUserId,
  selectedTab,
}: {
  ownerUserId: string;
  selectedTab: "today" | "review";
}) {
  if (selectedTab === "review") {
    return (
      <DashboardRail
        birthdays={[]}
        calendarSuggestions={[]}
        dailyBrief={null}
        followupReviews={[]}
        followups={[]}
        initialTab="review"
        people={[]}
        reviewContent={<ReviewQueueStreams ownerUserId={ownerUserId} />}
        reviewQueue={{ count: 0, failures: [], items: [] }}
        weeklyBrief={null}
      />
    );
  }

  const [people, followups, followupReviews, calendarSuggestions, dailyBrief, weeklyBrief] =
    await Promise.all([
      searchPeople({ ownerUserId, limit: 8 }),
      getDashboardFollowups(ownerUserId),
      getDashboardFollowupReviews(ownerUserId),
      getDashboardCalendarSuggestions(ownerUserId),
      getDashboardBrief(ownerUserId, "daily"),
      getDashboardBrief(ownerUserId, "weekly"),
    ]);

  return (
    <DashboardRail
      birthdays={getUpcomingBirthdays(people)}
      calendarSuggestions={calendarSuggestions}
      dailyBrief={dailyBrief}
      followupReviews={followupReviews}
      followups={followups}
      initialTab="today"
      people={people}
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

async function HomeMobileContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/" });
  const todayContext = await getOwnerTodayContext({ ownerUserId });
  const todayShortlist = await getHomeToday(ownerUserId, todayContext);

  return (
    <MobileTodayDestination
      mobileEve={
        <Suspense fallback={<div className="h-full animate-pulse rounded-xl border bg-muted/40" />}>
          <HomeAssistant ownerUserId={ownerUserId} />
        </Suspense>
      }
      ownerUserId={ownerUserId}
      todayHandlers={{
        act: actOnTodayItemAction,
        refresh: refreshTodayAction,
        suppress: suppressTodayItemAction,
      }}
      todayInitial={todayShortlist}
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

async function getDashboardFollowups(ownerUserId: string) {
  try {
    // The soonest active reminders across people, due-first, each named by person.
    const followups = await listActiveFollowups({
      ownerUserId,
      limit: DASHBOARD_FOLLOWUP_LIMIT,
    });

    return followups.map((summary) => toDashboardFollowupView(summary));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load active follow-ups.", error);
    }

    return [];
  }
}

async function getDashboardFollowupReviews(ownerUserId: string) {
  try {
    // A few of the soonest suggested follow-ups across people, for inline review.
    const reviews = await listSuggestedFollowupReviews({
      ownerUserId,
      limit: DASHBOARD_FOLLOWUP_LIMIT,
    });

    return reviews.map((review) => toSuggestedFollowupReviewView(review));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load suggested follow-ups.", error);
    }

    return [];
  }
}

async function getDashboardCalendarSuggestions(ownerUserId: string) {
  try {
    const suggestions = await listCalendarSuggestedFollowups(ownerUserId);
    return suggestions
      .slice(0, DASHBOARD_FOLLOWUP_LIMIT)
      .map((suggestion) => toCalendarSuggestionReviewView(suggestion));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load Calendar suggested follow-ups.", error);
    }

    return [];
  }
}
