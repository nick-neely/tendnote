import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AdmittedRoute } from "@/components/admitted-route";
import { GiftPlanDetailSurface } from "@/components/gift-plan-detail-surface";
import { ArrowLeftIcon } from "@/components/icons";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getCachedGiftPlanDetailView } from "@/lib/cache/gift-plan-views";

type GiftPlanPageProps = { params: Promise<{ giftPlanId: string }> };

/**
 * The shell resolves nothing. `params` is awaited inside the content component,
 * behind the route's own boundary, so the static shell still prerenders and the
 * plan streams in — awaiting it out here would block the whole route.
 */
export default function GiftPlanPage({ params }: GiftPlanPageProps) {
  return (
    <AdmittedRoute destination="gift-plan">
      <GiftPlanContent params={params} />
    </AdmittedRoute>
  );
}

async function GiftPlanContent({ params }: GiftPlanPageProps) {
  if (process.env.NODE_ENV !== "test") await connection();
  const { giftPlanId } = await params;
  const callerUserId = await requireAdmittedOwner({
    returnTo: `/gift-plans/${encodeURIComponent(giftPlanId)}`,
  });
  const shareableMembers = await listShareableHouseholdMembersForUser({ userId: callerUserId });
  const names = Object.fromEntries(
    shareableMembers.map((member) => [member.userId, member.name || member.email]),
  );
  const detail = await getCachedGiftPlanDetailView({
    callerUserId,
    giftPlanId,
    people: {
      callerUserId,
      names,
    },
    now: new Date(),
  });

  /**
   * The deep-link half of the exclusion.
   *
   * The seam answers `null` for a plan that does not exist, one that was never
   * shared with this caller, one in a household they have left, and one that is
   * a surprise for them. All four land here, and all four render the same
   * not-found page — so a link forwarded to the Surprise Subject tells them
   * nothing at all (ADR 0216, ADR 0219).
   */
  if (!detail) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link
        className="inline-flex w-fit items-center gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground transition-colors hover:text-foreground"
        href="/gift-plans"
      >
        <ArrowLeftIcon aria-hidden className="size-3.5" />
        Gift plans
      </Link>
      <GiftPlanDetailSurface
        detail={detail}
        shareableMembers={shareableMembers.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
        }))}
      />
    </div>
  );
}
