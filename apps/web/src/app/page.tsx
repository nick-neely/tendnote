import { listSourceRecordReviews, searchPeople } from "@tendnote/db";
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
  const [people, recentSourceRecordReviews] = await Promise.all([
    searchPeople({ limit: 8 }),
    getRecentSourceRecordReviews(),
  ]);
  const birthdays = getUpcomingBirthdays(people);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 lg:gap-8">
        <DashboardGreeting />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-8">
          <div className="order-2 lg:order-1">
            <AssistantPanel initialSourceRecordReviews={recentSourceRecordReviews} />
          </div>
          <div className="order-1 lg:order-2">
            <TodayRail
              birthdays={birthdays}
              pendingReviewCount={recentSourceRecordReviews.length}
              people={people}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

async function getRecentSourceRecordReviews(): Promise<SourceRecordReviewView[]> {
  try {
    const ownerUserId = await getCurrentOwnerUserId();
    const reviews = await listSourceRecordReviews({ ownerUserId, limit: 3 });

    return reviews.map(toSourceRecordReviewView);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load source record reviews.", error);
    }

    return [];
  }
}
