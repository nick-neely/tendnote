import {
  claimSelfContextOnboardingReminder,
  getSelfContextOnboardingState,
} from "@tendnote/db/queries/access-profiles";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { SelfContextLaterInvitation } from "@/components/account/self-context-later-invitation";
import { appDestination } from "@/components/app-destinations";
import { requireAdmittedOwner } from "@/lib/access/current-access";

export type SelfContextHomeInvitationProps = {
  searchParams?: Promise<{ selfContext?: string; tab?: string }>;
};

/**
 * Resolve the one quiet post-dismissal invitation in its own streamed region.
 * Setup is optional: this component never redirects or owns Home's canvas.
 */
export async function SelfContextHomeInvitation({ searchParams }: SelfContextHomeInvitationProps) {
  if (process.env.NODE_ENV !== "test") await connection();
  const params = await searchParams;
  const returnTo =
    params?.tab === "review" ? appDestination("review").route : appDestination("today").route;
  const ownerUserId = await requireAdmittedOwner({ returnTo });

  // A dismissal returns through this marker so the invitation is truly later,
  // rather than an immediate nag on the same navigation that skipped setup.
  if (params?.selfContext === "skipped") return null;

  try {
    const state = await getSelfContextOnboardingState({ userId: ownerUserId });
    if (state?.status !== "dismissed" || state.reminderAt !== null) return null;

    const claim = await claimSelfContextOnboardingReminder({ userId: ownerUserId });
    return claim.claimed ? (
      <div className="w-full max-w-2xl">
        <SelfContextLaterInvitation />
      </div>
    ) : null;
  } catch (error) {
    unstable_rethrow(error);
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to resolve Self Context setup state.", error);
    }
    return null;
  }
}
