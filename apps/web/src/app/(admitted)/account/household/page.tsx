import { getHouseholdOverviewForUser } from "@tendnote/db/queries/households";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { HouseholdSurface } from "@/components/account/household-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";
import { requireAdmittedOwner } from "@/lib/access/current-access";

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
        <HouseholdSurface initialOverview={overview} />
      </HouseholdShell>
    );
  } catch (error) {
    unstable_rethrow(error);
    return <HouseholdUnavailable />;
  }
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
