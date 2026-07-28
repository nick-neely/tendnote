import Link from "next/link";
import { connection } from "next/server";
import { ActionTodaySurface } from "@/components/action-today-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { groupActionTodayItems, selectActionTodayItems } from "@/lib/action-today";
import { getCachedActionTodayViews } from "@/lib/cache/action-views";

/**
 * The narrow Action Today surface (ADR 0157): a calm daily glance at the Actions and
 * Routines that are due, overdue, or resurfaced right now — not the Phase 7 cross-domain
 * Today dashboard. It shows every action the caller may see (their own plus visible
 * household and selected-shared ones), unlike the owner-scoped scoped summary; the
 * shared surfacing predicate keeps the two in agreement about what is "on today".
 */
export default function ActionTodayPage() {
  return (
    <AdmittedRoute destination="action-today">
      <ActionTodayContent />
    </AdmittedRoute>
  );
}

async function ActionTodayContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/actions/today" });
  const now = new Date();

  const active = await getCachedActionTodayViews({ ownerUserId, now });
  const items = selectActionTodayItems(active, now);
  const groups = groupActionTodayItems(items);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
            {appDestination("action-today").label}
          </h1>
          <Link
            className="rounded-sm text-[length:var(--text-small)] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href="/actions"
          >
            All actions
          </Link>
        </div>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The actions and routines that are due, overdue, or set aside and back around. Everything
          else waits on Actions.
        </p>
      </header>

      <ActionTodaySurface groups={groups} />
    </div>
  );
}
