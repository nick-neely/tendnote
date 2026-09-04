import { ensureDefaultGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import Link from "next/link";
import { connection } from "next/server";
import { ActionsSurface } from "@/components/actions-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getCachedActionPrimaryViews } from "@/lib/cache/action-views";

// A calm cap on the resolved trail — enough to reopen a recent mistake, not a
// backlog to clear (DESIGN.md calm-by-default).
const RESOLVED_LIMIT = 20;

export default function ActionsPage() {
  return (
    <AdmittedRoute destination="actions">
      <ActionsContent />
    </AdmittedRoute>
  );
}

async function ActionsContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/actions" });
  const now = new Date();

  // Seed the default Areas first, then stream the only useful initial region: the
  // bounded active ledger and its Area filter. Paused/resolved/review/reminder and
  // linking data stays behind the controls that reveal it (ADR 0206).
  await ensureDefaultGeneralActionAreas({ ownerUserId });
  const primary = await getCachedActionPrimaryViews({ ownerUserId, now });
  // The household roster is still secondary data, but a row that is the
  // household's, or someone else's, needs a name to attribute it to and members to
  // hand it to — and those are on screen from the first paint. So it is read only
  // when the visible ledger actually holds such a row; a private-only surface pays
  // nothing for it (ADR 0206).
  const needsHousehold = primary.active.some(
    (action) => action.ownership === "household_native" || !action.owned,
  );
  const shareableMembers = needsHousehold
    ? await listShareableHouseholdMembersForUser({ userId: ownerUserId })
    : [];
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
            {appDestination("actions").label}
          </h1>
          <Link
            className="rounded-sm text-[length:var(--text-small)] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href="/actions/today"
          >
            Today
          </Link>
        </div>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Things to get done that aren't tied to a person. Private by default, or shared with your
          household.
        </p>
      </header>

      <ActionsSurface
        active={primary.active}
        areas={primary.areas}
        resolvedLimit={RESOLVED_LIMIT}
        shareableMembers={shareableMembers.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
        }))}
      />
    </div>
  );
}
