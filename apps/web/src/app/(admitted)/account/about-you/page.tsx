import {
  listSelfContextFacts,
  listSuggestedContextFactReviews,
} from "@tendnote/db/queries/context-facts";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AboutYouSurface } from "@/components/account/about-you-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toSuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";

export default function AboutYouPage() {
  return (
    <AdmittedRoute destination="account-about-you">
      <Suspense fallback={<AboutYouLoading />}>
        <AboutYouContent />
      </Suspense>
    </AdmittedRoute>
  );
}

export async function AboutYouContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const destination = appDestination("account-about-you");
  const ownerUserId = await requireAdmittedOwner({ returnTo: destination.route });

  try {
    const [facts, suggestedReviews] = await Promise.all([
      listSelfContextFacts(
        { callerUserId: ownerUserId, includeArchived: true },
        requireAdmittedOwner,
      ),
      listSuggestedContextFactReviews({ callerUserId: ownerUserId }, requireAdmittedOwner),
    ]);
    return (
      <AboutYouSurface
        initialFacts={facts}
        initialSuggestedReviews={suggestedReviews.map(toSuggestedContextFactReviewView)}
      />
    );
  } catch (error) {
    unstable_rethrow(error);
    return <AboutYouUnavailable />;
  }
}

export function AboutYouLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="About you loading"
      className="mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold">
          About you
        </h1>
        <div className="h-4 w-2/3 max-w-full animate-pulse rounded bg-muted" />
      </header>
      <div className="grid gap-3">
        <div className="h-24 rounded-xl border bg-muted/40" />
        <div className="h-24 rounded-xl border bg-muted/40" />
      </div>
    </section>
  );
}

function AboutYouUnavailable() {
  return (
    <section
      aria-labelledby="about-you-unavailable-heading"
      className="mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-3 rounded-xl border border-dashed bg-surface px-4 py-8"
    >
      <h1
        className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
        id="about-you-unavailable-heading"
      >
        About you is temporarily unavailable.
      </h1>
      <p className="max-w-[65ch] break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        Your existing facts are unchanged. Try again when you&rsquo;re ready.
      </p>
      <Button asChild className="min-h-11 w-full sm:w-fit" variant="outline">
        <Link href="/account/about-you">Try again</Link>
      </Button>
    </section>
  );
}
