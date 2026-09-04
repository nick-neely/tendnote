import { getHouseholdCheckin, getHouseholdHome } from "@tendnote/db/queries/household-home";
import {
  getHouseholdPlanningFrameForUser,
  type HouseholdPlanningFrame,
} from "@tendnote/db/queries/households";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import { householdCheckinIsWorthShowing } from "@tendnote/domain/household-checkin";
import { householdHomeSectionHeadings } from "@tendnote/domain/household-home";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { HouseholdCheckinChoice } from "@/components/household/household-checkin-choice";
import {
  HouseholdCheckinReserve,
  HouseholdCheckinSection,
} from "@/components/household/household-checkin-section";
import {
  HouseholdHomeSection,
  type HouseholdHomeSectionKey,
  HouseholdHomeSectionReserve,
} from "@/components/household/household-home-section";
import { HouseholdPlanningSections } from "@/components/household/household-planning-sections";
import { HOUSEHOLD_SECTION_HEADING_CLASS } from "@/components/household/household-record-row";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getHouseholdSharedContext } from "@/lib/household/household-shared-data";

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
  const household = await getHouseholdPlanningFrameForUser({ userId: ownerUserId });
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

      {/* One column, in this order, at every width. The primary sections and
          secondary planning region stream behind their own reserves so a slow
          read never holds up work that is already ready. */}
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

      {/* Calendars and Plans are one secondary coordination region: the
          Calendar gesture hands an event address directly to the Plan form, so
          keeping them adjacent is a product boundary rather than visual
          grouping. This stream proves standing again and never delays the two
          capped primary lists above it. */}
      <Suspense fallback={<HouseholdPlanningReserve />}>
        <HouseholdPlanningStream frame={household} ownerUserId={ownerUserId} />
      </Suspense>

      {/* The check-in remains one member's private read, offered after shared
          household work rather than composed into it (ADR 0220). */}
      <Suspense fallback={<HouseholdCheckinReserve />}>
        <HouseholdCheckinStream householdName={household.name} ownerUserId={ownerUserId} />
      </Suspense>

      <HouseholdHomeFooter />
    </div>
  );
}

/** The canonical Calendar/Event Plan region for one currently admitted member. */
export async function HouseholdPlanningStream({
  frame,
  ownerUserId,
}: {
  frame: HouseholdPlanningFrame;
  ownerUserId: string;
}) {
  const planning = await getHouseholdSharedContext(ownerUserId);
  return (
    <HouseholdPlanningSections
      calendars={planning.calendars}
      linkCandidates={planning.linkCandidates}
      members={frame.members}
      now={planning.now}
      plans={planning.plans}
      viewerHasCalendarAccess={planning.viewerHasCalendarAccess}
      viewerRole={frame.viewerRole}
      viewerUserId={ownerUserId}
    />
  );
}

function HouseholdPlanningReserve() {
  return (
    <div aria-busy="true" aria-label="Shared calendars and event plans" role="status">
      <section className="h-24 animate-pulse rounded-lg border bg-muted/40" />
      <span className="sr-only">Shared calendars and event plans</span>
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
 * The member's own check-in, and the choice about whether their brief carries it.
 *
 * Composed here rather than reusing the memoised home read: the check-in has its
 * own opt-in gate and its own cap, and it re-reads standing at the moment it is
 * rendered — which is the last safe point for a surface whose authorization can
 * end mid-session. The choice is always offered; the section only appears when
 * the member has asked for it and the household actually has something timely.
 */
export async function HouseholdCheckinStream({
  householdName,
  ownerUserId,
}: {
  householdName: string;
  ownerUserId: string;
}) {
  try {
    const { localDate, timeZone, now } = await getOwnerTodayContext({ ownerUserId });
    const checkin = await getHouseholdCheckin({
      callerUserId: ownerUserId,
      localDate,
      timeZone,
      now,
    });

    // No rule of its own: the section above already closes on a hairline, and a
    // second one just below it reads as a seam rather than a separation. The
    // page's own rhythm is the boundary here.
    return (
      <div className="flex flex-col gap-4">
        {householdCheckinIsWorthShowing(checkin) ? (
          <HouseholdCheckinSection
            context="home"
            headingId="household-checkin"
            householdName={householdName}
            limitations={checkin.limitations}
            records={checkin.records}
          />
        ) : null}
        <HouseholdCheckinChoice enabled={checkin.optedIn} />
      </div>
    );
  } catch (error) {
    unstable_rethrow(error);
    // The check-in is the smallest thing on this page. If it cannot be read, the
    // page says nothing about it rather than claiming the household is quiet.
    return null;
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
      <h2 className={HOUSEHOLD_SECTION_HEADING_CLASS}>{heading}</h2>
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
 *
 * The links carry it alone. A line above them saying "Shared Actions and
 * Routines appear here" named the same two things the first link is named after,
 * one line apart — and in the state where a member actually needs telling, the
 * empty section above has already said it and offered the way there.
 */
function HouseholdHomeFooter() {
  return (
    <footer className="border-t pt-6">
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
