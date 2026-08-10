import { getHouseholdOverviewForUser } from "@tendnote/db/queries/households";
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HouseholdSharedSections } from "@/components/account/household-shared-sections";
import { HouseholdSurface } from "@/components/account/household-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getHouseholdSharedContext } from "@/lib/household/household-shared-data";

export default function HouseholdPage() {
  return (
    <AdmittedRoute destination="account-household">
      <HouseholdContent />
    </AdmittedRoute>
  );
}

export async function HouseholdContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const destination = appDestination("account-household");
  const ownerUserId = await requireAdmittedOwner({ returnTo: destination.route });

  try {
    const overview = await getHouseholdOverviewForUser({ userId: ownerUserId });
    return (
      <HouseholdShell>
        <HouseholdSurface
          initialOverview={overview}
          sharedSections={
            overview ? (
              /*
               * Its own boundary, because these two sections are the only part
               * of this page that waits on a provider. Without it the roster,
               * the invitations, and the governance controls - all of which are
               * already in hand - would sit behind a Google round trip. The
               * Account page suspends its own Calendar preview for the same
               * reason.
               */
              <Suspense fallback={<SharedSectionsReserve />}>
                <SharedSections overview={overview} userId={ownerUserId} />
              </Suspense>
            ) : undefined
          }
        />
      </HouseholdShell>
    );
  } catch (error) {
    unstable_rethrow(error);
    return <HouseholdUnavailable />;
  }
}

/**
 * The household's shared Calendar and Event Plan sections (issue #387).
 *
 * Read here rather than inside the surface because both reads are server-side
 * and authorized in their own domain seams, and read only when there is an
 * active household to read them for - the same membership that produced the
 * Overview is the one those seams prove again for themselves.
 *
 * These two bring Account > Household to seven stacked sections, and the Plans
 * list is uncapped. That is deliberate for now: spec #376 says not to create a
 * global Household destination until a supported coordination domain exists,
 * and this is the first one. It is also the point at which the question becomes
 * real - #384's Household home is the intended answer, and when it lands, the
 * shared sections belong there with Account keeping governance. Until then,
 * whoever adds the eighth section should treat this comment as the marker that
 * the page has run out of room rather than as permission to keep stacking.
 */
async function SharedSections({
  overview,
  userId,
}: {
  overview: HouseholdOverview;
  userId: string;
}) {
  const shared = await getHouseholdSharedContext(userId);
  return (
    <HouseholdSharedSections
      calendars={shared.calendars}
      linkCandidates={shared.linkCandidates}
      members={overview.members}
      now={shared.now}
      plans={shared.plans}
      viewerHasCalendarAccess={shared.viewerHasCalendarAccess}
      viewerRole={overview.viewerRole}
      viewerUserId={userId}
    />
  );
}

function SharedSectionsReserve() {
  return (
    <section
      aria-busy="true"
      aria-label="Shared calendars and event plans"
      className="h-24 animate-pulse rounded-lg border bg-muted/40"
    />
  );
}

/**
 * Account owns the Household entry and return point, so the way back to Account
 * is part of the page rather than an assumed browser gesture. There is no
 * top-level Household destination to return to instead.
 */
function HouseholdShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          className="self-start text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground underline underline-offset-2"
          href={appDestination("account").route}
        >
          Back to account
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
            {appDestination("account-household").label}
          </h1>
          <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
            A small shared layer for the people you live with. You&rsquo;re in one household at a
            time.
          </p>
        </div>
      </header>
      {children}
    </div>
  );
}

function HouseholdUnavailable() {
  return (
    <HouseholdShell>
      <section
        aria-labelledby="household-unavailable-heading"
        className="flex flex-col gap-3 rounded-xl border border-dashed bg-surface px-4 py-8"
      >
        <h2
          className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
          id="household-unavailable-heading"
        >
          Household is temporarily unavailable.
        </h2>
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Nothing changed. Try again when you&rsquo;re ready.
        </p>
        <Button asChild className="min-h-11 w-full sm:w-fit" variant="outline">
          <Link href={appDestination("account-household").route}>Try again</Link>
        </Button>
      </section>
    </HouseholdShell>
  );
}
