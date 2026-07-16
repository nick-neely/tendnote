import { listAssetReviewGroups } from "@tendnote/db/queries/assets";
import { getCurrentBrief } from "@tendnote/db/queries/briefs";
import { listCalendarSuggestedFollowups } from "@tendnote/db/queries/calendar-followups";
import { listActiveFollowups, listSuggestedFollowupReviews } from "@tendnote/db/queries/followups";
import { listSuggestedGeneralActionReviews } from "@tendnote/db/queries/general-actions";
import { listSuggestedMemoryReviews } from "@tendnote/db/queries/memories";
import { searchPeople } from "@tendnote/db/queries/people";
import type { BriefCadence } from "@tendnote/domain";
import { AppShell } from "@/components/app-shell";
import { AssistantPanel } from "@/components/assistant-panel";
import { DashboardGreeting } from "@/components/dashboard-greeting";
import { DashboardRail } from "@/components/dashboard-rail";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toAssetReviewGroupViewWithOrigin } from "@/lib/asset-review-origin";
import { currentLocalDate } from "@/lib/brief-local-date";
import { type BriefView, toBriefView } from "@/lib/brief-view";
import { toCalendarSuggestionReviewView } from "@/lib/calendar-suggestion-review-view";
import { getUpcomingBirthdays } from "@/lib/dashboard-brief";
import { toDashboardFollowupView } from "@/lib/followup-view";
import { getOwnerCalendarPromptNudges } from "@/lib/integrations/calendar-prompt-nudges";
import { toSuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";
import { toSuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";
import { toSuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

// The dashboard surfaces the most important open suggestions, not all of them;
// the long tail still lives on each person's ledger. Keeping the rail short keeps
// it a calm prompt, not a backlog (PRD: 1–3 timely things by default).
const DASHBOARD_REVIEW_LIMIT = 6;

// A handful of the soonest active reminders — a calm prompt, not a task feed (#45).
const DASHBOARD_FOLLOWUP_LIMIT = 5;

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const ownerUserId = await requireAdmittedOwner();
  const requestedTab = (await searchParams)?.tab;
  const [
    people,
    dashboardReviews,
    dashboardActionReviews,
    dashboardAssetReviews,
    dashboardFollowups,
    dashboardFollowupReviews,
    dashboardCalendarSuggestions,
    dailyBrief,
    weeklyBrief,
    calendarNudges,
  ] = await Promise.all([
    searchPeople({ ownerUserId, limit: 8 }),
    getDashboardReviews(ownerUserId),
    getDashboardActionReviews(ownerUserId),
    getDashboardAssetReviews(ownerUserId),
    getDashboardFollowups(ownerUserId),
    getDashboardFollowupReviews(ownerUserId),
    getDashboardCalendarSuggestions(ownerUserId),
    getDashboardBrief(ownerUserId, "daily"),
    getDashboardBrief(ownerUserId, "weekly"),
    getOwnerCalendarPromptNudges(),
  ]);
  const birthdays = getUpcomingBirthdays(people);

  return (
    <AppShell>
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
            <AssistantPanel nudges={calendarNudges} />
          </div>
          {/* The rail manages its own scroll inside the active tab panel (the tab
              bar stays pinned), so the column itself is only height-bounded. */}
          <div className="order-2 lg:h-full lg:min-h-0">
            <DashboardRail
              actionReviews={dashboardActionReviews}
              assetReviews={dashboardAssetReviews}
              birthdays={birthdays}
              dailyBrief={dailyBrief}
              followupReviews={dashboardFollowupReviews}
              followups={dashboardFollowups}
              calendarSuggestions={dashboardCalendarSuggestions}
              people={people}
              reviews={dashboardReviews}
              weeklyBrief={weeklyBrief}
              initialTab={requestedTab === "review" ? "review" : "today"}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
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

async function getDashboardReviews(ownerUserId: string) {
  try {
    // No personId → every open suggestion across people, ranked by importance
    // then recency in the store. Person names are resolved by the caller.
    const reviews = await listSuggestedMemoryReviews({
      ownerUserId,
      limit: DASHBOARD_REVIEW_LIMIT,
    });

    return reviews.map(toSuggestedMemoryReviewView);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load suggested memory reviews.", error);
    }

    return [];
  }
}

async function getDashboardAssetReviews(ownerUserId: string) {
  try {
    // A few of the newest pending Asset Review Groups — grouped asset review in
    // the shared queue, one card per source context (#198).
    const groups = await listAssetReviewGroups({ ownerUserId, limit: DASHBOARD_REVIEW_LIMIT });
    return Promise.all(groups.map((group) => toAssetReviewGroupViewWithOrigin(group)));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load asset review groups.", error);
    }

    return [];
  }
}

async function getDashboardActionReviews(ownerUserId: string) {
  try {
    // A few of the newest Suggested actions for the shared Review Queue. Area names are
    // resolved on the Actions surface, not here — the rail card is a compact glance.
    const reviews = await listSuggestedGeneralActionReviews({
      ownerUserId,
      limit: DASHBOARD_REVIEW_LIMIT,
    });

    return reviews.map((review) =>
      toSuggestedGeneralActionReviewView(review, { callerUserId: ownerUserId }),
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load Suggested action reviews.", error);
    }

    return [];
  }
}
