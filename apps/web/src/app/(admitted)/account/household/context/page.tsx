import {
  listHouseholdContextFacts,
  listSuggestedContextFactReviews,
} from "@tendnote/db/queries/context-facts";
import {
  getHouseholdOverviewForUser,
  listHouseholdContextActors,
} from "@tendnote/db/queries/households";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { HouseholdContextSurface } from "@/components/account/household-context-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toSuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";

export default function HouseholdContextPage() {
  return (
    <AdmittedRoute destination="account-household-context">
      <HouseholdContextContent />
    </AdmittedRoute>
  );
}

export async function HouseholdContextContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const destination = appDestination("account-household-context");
  const ownerUserId = await requireAdmittedOwner({ returnTo: destination.route });

  try {
    // The Overview read is how this page learns there is a household at all. It
    // is the same authorized read the Household page uses, so a caller whose
    // membership ended between navigations lands on the no-household state
    // rather than on an empty management screen.
    const overview = await getHouseholdOverviewForUser({ userId: ownerUserId });
    if (!overview) return <HouseholdContextUnavailable />;

    const [facts, identities, reviews] = await Promise.all([
      listHouseholdContextFacts(
        { callerUserId: ownerUserId, includeArchived: true },
        async () => ownerUserId,
      ),
      listHouseholdContextActors({ userId: ownerUserId }),
      listSuggestedContextFactReviews({ callerUserId: ownerUserId }, async () => ownerUserId),
    ]);
    // The shared queue carries both subjects; this page shows only the ones the
    // household owns. The caller's private suggestions belong to About you.
    const suggestions = reviews
      .filter((review) => review.fact.subject.kind === "household")
      .map(toSuggestedContextFactReviewView);

    return (
      <HouseholdContextShell householdName={overview.name}>
        <HouseholdContextSurface
          identities={identities}
          initialFacts={facts}
          initialSuggestions={suggestions}
          renderedAt={new Date()}
          viewerUserId={ownerUserId}
        />
      </HouseholdContextShell>
    );
  } catch (error) {
    unstable_rethrow(error);
    return <HouseholdContextUnavailable />;
  }
}

/**
 * A subpage beneath Overview, and it says so.
 *
 * The way back is to Household rather than to Account, because that is where
 * this page's parent is; and the household's own name is the subtitle rather
 * than the H1, so the screen title stays the thing the reader came to do.
 */
function HouseholdContextShell({
  children,
  householdName,
}: {
  children: React.ReactNode;
  householdName?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Link
          className="self-start text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground underline underline-offset-2"
          href={appDestination("account-household").route}
        >
          Back to household
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
            Household context
          </h1>
          <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
            {householdName
              ? `A few current facts everyone in ${householdName} can read and correct.`
              : "A few current facts everyone in the household can read and correct."}{" "}
            Keep it to what stays true for a while — plans and open questions have their own places.
          </p>
        </div>
      </header>
      {children}
    </div>
  );
}

function HouseholdContextUnavailable() {
  return (
    <HouseholdContextShell>
      <section
        aria-labelledby="household-context-unavailable-heading"
        className="flex flex-col gap-3 rounded-xl border border-dashed bg-surface px-4 py-8"
      >
        <h2
          className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
          id="household-context-unavailable-heading"
        >
          There&rsquo;s nothing to show here.
        </h2>
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Shared context belongs to a household, and you&rsquo;re not in one right now. Nothing
          changed.
        </p>
        <Button asChild className="min-h-11 w-full sm:w-fit" variant="outline">
          <Link href={appDestination("account-household").route}>Go to Household</Link>
        </Button>
      </section>
    </HouseholdContextShell>
  );
}
