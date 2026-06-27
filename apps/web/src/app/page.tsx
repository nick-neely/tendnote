import { searchPeople } from "@tendnote/db/queries/people";
import { listSourceRecordReviews } from "@tendnote/db/queries/source-records";
import { AppShell } from "@/components/app-shell";
import { AssistantPanel } from "@/components/assistant-panel";
import { DashboardGreeting } from "@/components/dashboard-greeting";
import { TodayRail } from "@/components/today-rail";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import { getUpcomingBirthdays } from "@/lib/dashboard-brief";
import {
  type SourceRecordReviewView,
  toSourceRecordReviewView,
} from "@/lib/source-record-review-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ownerUserId = await getCurrentOwnerUserId();
  const [people, recentSourceRecordReviews] = await Promise.all([
    searchPeople({ ownerUserId, limit: 8 }),
    getRecentSourceRecordReviews(ownerUserId),
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
            column grows past the viewport instead of scrolling inside itself. */}
        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)] lg:gap-8">
          <div className="order-2 h-[70dvh] lg:order-1 lg:h-full lg:min-h-0">
            <AssistantPanel />
          </div>
          <div className="order-1 lg:order-2 lg:h-full lg:min-h-0 lg:overflow-y-auto">
            <TodayRail birthdays={birthdays} people={people} reviews={recentSourceRecordReviews} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

async function getRecentSourceRecordReviews(
  ownerUserId: string,
): Promise<SourceRecordReviewView[]> {
  try {
    const reviews = await listSourceRecordReviews({ ownerUserId, limit: 3 });

    return reviews.map(toSourceRecordReviewView);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load source record reviews.", error);
    }

    return [];
  }
}
