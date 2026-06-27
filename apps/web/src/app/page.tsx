import { listSuggestedMemoryReviews } from "@tendnote/db/queries/memories";
import { searchPeople } from "@tendnote/db/queries/people";
import { AppShell } from "@/components/app-shell";
import { AssistantPanel } from "@/components/assistant-panel";
import { DashboardGreeting } from "@/components/dashboard-greeting";
import { TodayRail } from "@/components/today-rail";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import { getUpcomingBirthdays } from "@/lib/dashboard-brief";
import { toSuggestedMemoryReviewView } from "@/lib/suggested-memory-review-view";

// The dashboard surfaces the most important open suggestions, not all of them;
// the long tail still lives on each person's ledger. Keeping the rail short keeps
// it a calm prompt, not a backlog (PRD: 1–3 timely things by default).
const DASHBOARD_REVIEW_LIMIT = 6;

export const dynamic = "force-dynamic";

export default async function Home() {
  const ownerUserId = await getCurrentOwnerUserId();
  const [people, dashboardReviews] = await Promise.all([
    searchPeople({ ownerUserId, limit: 8 }),
    getDashboardReviews(ownerUserId),
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
            stays the left content column with the rail on the right. */}
        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)] lg:gap-8">
          <div className="order-1 h-[70dvh] lg:h-full lg:min-h-0">
            <AssistantPanel />
          </div>
          <div className="order-2 lg:h-full lg:min-h-0 lg:overflow-y-auto">
            <TodayRail birthdays={birthdays} people={people} reviews={dashboardReviews} />
          </div>
        </div>
      </div>
    </AppShell>
  );
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
