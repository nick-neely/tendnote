import { getHouseholdHome } from "@tendnote/db/queries/household-home";
import { getAdmittedHouseholdForUser } from "@tendnote/db/queries/households";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import { householdHomeSectionHeadings } from "@tendnote/domain/household-home";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import {
  HouseholdHomeSection,
  type HouseholdHomeSectionKey,
  HouseholdHomeSectionReserve,
} from "@/components/household/household-home-section";
import { requireAdmittedOwner } from "@/lib/access/current-access";

export default function HouseholdHomePage() {
  return (
    <AdmittedRoute destination="household">
      <HouseholdHomeContent />
    </AdmittedRoute>
  );
}

/**
 * The composed home for one member, read once per request.
 *
 * Both sections come from the same composition, so the household's two lists
 * cannot disagree about what it has. `cache` is a request memo, not a data
 * cache: the surface is online-required, and a shared read whose authorization
 * can end mid-session is never served from a store that outlives the membership
 * behind it.
 */
const readHouseholdHome = cache(async function readHouseholdHome(callerUserId: string) {
  const { localDate, timeZone, now } = await getOwnerTodayContext({ ownerUserId: callerUserId });
  return getHouseholdHome({ callerUserId, localDate, timeZone, now });
});

export async function HouseholdHomeContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const destination = appDestination("household");
  const ownerUserId = await requireAdmittedOwner({ returnTo: destination.route });

  /**
   * The frame is resolved before anything renders. A member who has left, was
   * removed, or whose household was dissolved has no Household destination at
   * all, so they are returned to Account rather than shown an emptied version
   * of a page they can no longer be on. Account already holds the neutral
   * explanation of what happened and the way back in.
   */
  const household = await getAdmittedHouseholdForUser({ userId: ownerUserId });
  if (!household) {
    redirect(appDestination("account-household").route);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-[length:var(--text-h1)] leading-[var(--text-h1-line)] tracking-normal">
          {household.name}
        </h1>
        <p className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground text-pretty leading-[var(--text-small-line)]">
          What you&rsquo;re coordinating together.
        </p>
      </header>

      {/* One column, in this order, at every width. The two sections stream
          behind their own reserves so a slow one never holds up the other. */}
      <Suspense
        fallback={
          <HouseholdHomeSectionReserve heading={householdHomeSectionHeadings.needs_attention} />
        }
      >
        <HouseholdHomeStream ownerUserId={ownerUserId} sectionKey="needsAttention" />
      </Suspense>
      <Suspense
        fallback={<HouseholdHomeSectionReserve heading={householdHomeSectionHeadings.coming_up} />}
      >
        <HouseholdHomeStream ownerUserId={ownerUserId} sectionKey="comingUp" />
      </Suspense>

      <HouseholdHomeFooter />
    </div>
  );
}

/**
 * One section, streamed behind its own boundary.
 *
 * Both sections read the same memoised composition, so the household's two
 * lists always describe one state; the boundaries are separate so a slow or
 * failing read costs one section rather than the page.
 */
export async function HouseholdHomeStream({
  ownerUserId,
  sectionKey,
}: {
  ownerUserId: string;
  sectionKey: HouseholdHomeSectionKey;
}) {
  const heading =
    householdHomeSectionHeadings[sectionKey === "needsAttention" ? "needs_attention" : "coming_up"];
  try {
    const home = await readHouseholdHome(ownerUserId);
    return <HouseholdHomeSection sectionKey={sectionKey} view={home[sectionKey]} />;
  } catch (error) {
    unstable_rethrow(error);
    return <HouseholdHomeSectionUnavailable heading={heading} />;
  }
}

/**
 * A section that could not be read.
 *
 * It says what is true — this part is unavailable and nothing changed — and
 * never borrows the empty state's words, because "nothing here" and "we could
 * not look" are different facts and a household reading the wrong one would
 * believe a chore had been dealt with.
 */
function HouseholdHomeSectionUnavailable({ heading }: { heading: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-[length:var(--text-h2)] leading-[var(--text-h2-line)] tracking-normal">
        {heading}
      </h2>
      {/* The dashed box of the product's one empty treatment, with its own
          words. The primary line carries full-strength ink like that
          treatment's title does: an all-muted block is the faint "bare muted
          line" the product retired, and this is the one state a member most
          needs to actually read (DESIGN.md §6, §8). */}
      <div
        className="flex flex-col gap-1 rounded-xl border border-dashed bg-surface px-4 py-6"
        role="status"
      >
        <p className="font-medium text-[length:var(--text-small)] text-foreground leading-[var(--text-small-line)]">
          This part of Household is temporarily unavailable.
        </p>
        <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          Nothing changed. Try again when you&rsquo;re ready.
        </p>
      </div>
    </section>
  );
}

/**
 * Where shared records come from, and the way back to governance.
 *
 * Two quiet links, not a toolbar: the home is read-first, and the only things
 * worth offering beneath it are the domain that currently supplies it and the
 * Account surface that owns who is in the household.
 */
function HouseholdHomeFooter() {
  return (
    <footer className="flex flex-col gap-2 border-t pt-6">
      <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        Shared Actions and Routines appear here.
      </p>
      <nav aria-label="Household surfaces" className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link
          className="inline-flex min-h-11 items-center font-medium text-[length:var(--text-small)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={appDestination("actions").route}
        >
          Actions and Routines
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-[length:var(--text-small)] text-muted-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={appDestination("account-household").route}
        >
          Manage household
        </Link>
      </nav>
    </footer>
  );
}
