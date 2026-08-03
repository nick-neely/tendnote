import { getSelfContextOnboardingState } from "@tendnote/db/queries/access-profiles";
import {
  listSelfContextFacts,
  listSuggestedContextFactReviews,
} from "@tendnote/db/queries/context-facts";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { AboutYouSurface } from "@/components/account/about-you-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toSuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";

export default function AboutYouPage() {
  return (
    <AdmittedRoute destination="account-about-you">
      <AboutYouContent />
    </AdmittedRoute>
  );
}

export async function AboutYouContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const destination = appDestination("account-about-you");
  const ownerUserId = await requireAdmittedOwner({ returnTo: destination.route });

  try {
    const [facts, suggestedReviews, onboarding] = await Promise.all([
      listSelfContextFacts(
        { callerUserId: ownerUserId, includeArchived: true },
        requireAdmittedOwner,
      ),
      listSuggestedContextFactReviews({ callerUserId: ownerUserId }, requireAdmittedOwner),
      getSelfContextOnboardingState({ userId: ownerUserId }),
    ]);
    return (
      <AboutYouSurface
        initialFacts={facts}
        initialSuggestedReviews={suggestedReviews.map(toSuggestedContextFactReviewView)}
        // Home's post-dismissal nudge fires at most once, and nothing else links
        // to the guided prompts, so a user who skipped would have no way back.
        // Finishing setup is what retires the offer, not visiting this page.
        offerGuidedSetup={onboarding?.status !== "completed"}
      />
    );
  } catch (error) {
    unstable_rethrow(error);
    return <AboutYouUnavailable />;
  }
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
