import { getCurrentBrief } from "@tendnote/db/queries/briefs";
import { listCalendarSuggestedFollowups } from "@tendnote/db/queries/calendar-followups";
import { listActiveFollowups, listSuggestedFollowupReviews } from "@tendnote/db/queries/followups";
import { searchPeople } from "@tendnote/db/queries/people";
import { getOwnerTodayContext, getTodayShortlist } from "@tendnote/db/queries/today";
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
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { currentLocalDate } from "@/lib/brief-local-date";
import { type BriefView, toBriefView } from "@/lib/brief-view";
import { toCalendarSuggestionReviewView } from "@/lib/calendar-suggestion-review-view";
import { suggestComposerPerson } from "@/lib/composer-suggestion";
import { getUpcomingBirthdays } from "@/lib/dashboard-brief";
import { toDashboardFollowupView } from "@/lib/followup-view";
import { getOwnerCalendarPromptNudges } from "@/lib/integrations/calendar-prompt-nudges";
import { loadOwnerReviewQueue } from "@/lib/review-queue.server";
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
      title="Today"
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
  const [
    people,
    reviewQueue,
    dashboardFollowups,
    dashboardFollowupReviews,
    dashboardCalendarSuggestions,
    dailyBrief,
    weeklyBrief,
    calendarNudges,
  ] = await Promise.all([
    searchPeople({ ownerUserId, limit: 8 }),
    loadOwnerReviewQueue(ownerUserId),
    getDashboardFollowups(ownerUserId),
    getDashboardFollowupReviews(ownerUserId),
    getDashboardCalendarSuggestions(ownerUserId),
    getDashboardBrief(ownerUserId, "daily"),
    getDashboardBrief(ownerUserId, "weekly"),
    getOwnerCalendarPromptNudges(),
  ]);
  const birthdays = getUpcomingBirthdays(people);
  const composerSuggestPersonName = suggestComposerPerson(dashboardFollowups, people);

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
          <div className="order-1 h-[70dvh] lg:h-full lg:min-h-0">
            <AssistantPanel
              nudges={calendarNudges}
              ownerUserId={ownerUserId}
              suggestPersonName={composerSuggestPersonName}
            />
          </div>
          {/* The rail manages its own scroll inside the active tab panel (the tab
              bar stays pinned), so the column itself is only height-bounded. */}
          <div className="order-2 lg:h-full lg:min-h-0">
            <DashboardRail
              birthdays={birthdays}
              dailyBrief={dailyBrief}
              followupReviews={dashboardFollowupReviews}
              followups={dashboardFollowups}
              calendarSuggestions={dashboardCalendarSuggestions}
              people={people}
              reviewQueue={reviewQueue}
              weeklyBrief={weeklyBrief}
              initialTab={requestedTab === "review" ? "review" : "today"}
            />
          </div>
        </div>
      </div>
    </>
  );
}

async function HomeMobileContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/" });
  const todayContext = await getOwnerTodayContext({ ownerUserId });
  const [todayShortlist, people, dashboardFollowups, calendarNudges] = await Promise.all([
    getHomeToday(ownerUserId, todayContext),
    searchPeople({ ownerUserId, limit: 8 }),
    getDashboardFollowups(ownerUserId),
    getOwnerCalendarPromptNudges(),
  ]);

  return (
    <MobileTodayDestination
      mobileEve={
        <AssistantPanel
          nudges={calendarNudges}
          ownerUserId={ownerUserId}
          suggestPersonName={suggestComposerPerson(dashboardFollowups, people)}
        />
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
    return await getTodayShortlist({ ownerUserId, ...context });
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
