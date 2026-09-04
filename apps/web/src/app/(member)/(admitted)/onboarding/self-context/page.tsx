import { getSelfContextOnboardingState } from "@tendnote/db/queries/access-profiles";
import { listSelfContextFacts } from "@tendnote/db/queries/context-facts";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { SelfContextOnboarding } from "@/components/account/self-context-onboarding";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { requireAdmittedOwner } from "@/lib/access/current-access";

export default function SelfContextOnboardingPage() {
  return (
    <AdmittedRoute destination="onboarding-self-context">
      <SelfContextOnboardingContent />
    </AdmittedRoute>
  );
}

export async function SelfContextOnboardingContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const destination = appDestination("onboarding-self-context");
  const ownerUserId = await requireAdmittedOwner({ returnTo: destination.route });

  try {
    const [state, facts] = await Promise.all([
      getSelfContextOnboardingState({ userId: ownerUserId }),
      listSelfContextFacts({ callerUserId: ownerUserId }, requireAdmittedOwner),
    ]);

    if (state?.status === "completed") {
      redirect("/");
    }

    return <SelfContextOnboarding initialFacts={facts} />;
  } catch (error) {
    unstable_rethrow(error);
    return <SelfContextOnboardingUnavailable />;
  }
}

function SelfContextOnboardingUnavailable() {
  return (
    <section
      aria-labelledby="self-context-onboarding-unavailable-heading"
      className="mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-3 rounded-xl border border-dashed bg-surface px-4 py-8"
    >
      <h1
        className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
        id="self-context-onboarding-unavailable-heading"
      >
        Self Context setup is temporarily unavailable.
      </h1>
      <p className="max-w-[65ch] break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        You can continue into Tendnote without setup. Try again when you&rsquo;re ready.
      </p>
    </section>
  );
}
