import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { connection } from "next/server";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { GiftPlansSurface } from "@/components/gift-plans-surface";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getCachedGiftPlanViews } from "@/lib/cache/gift-plan-views";

export default function GiftPlansPage() {
  return (
    <AdmittedRoute destination="gift-plans">
      <GiftPlansContent />
    </AdmittedRoute>
  );
}

async function GiftPlansContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const callerUserId = await requireAdmittedOwner({ returnTo: "/gift-plans" });
  const now = new Date();
  const shareableMembers = await listShareableHouseholdMembersForUser({ userId: callerUserId });
  const names = new Map(
    shareableMembers.map((member) => [member.userId, member.name || member.email]),
  );
  const plans = await getCachedGiftPlanViews({
    callerUserId,
    people: {
      callerUserId,
      nameFor: (userId) => names.get(userId) ?? "Someone in your household",
    },
    now,
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
          {appDestination("gift-plans").label}
        </h1>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Keep track of what to give someone, and plan it with the people who are in on it. Private
          until you say otherwise.
        </p>
      </header>

      <GiftPlansSurface
        plans={plans}
        shareableMembers={shareableMembers.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
        }))}
      />
    </div>
  );
}
