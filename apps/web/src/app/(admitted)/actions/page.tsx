import { ensureDefaultGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import Link from "next/link";
import { connection } from "next/server";
import { ActionsSurface } from "@/components/actions-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getCachedActionPrimaryViews } from "@/lib/cache/action-views";

// A calm cap on the resolved trail — enough to reopen a recent mistake, not a
// backlog to clear (DESIGN.md calm-by-default).
const RESOLVED_LIMIT = 20;

export default function ActionsPage() {
  return (
    <AdmittedRoute returnTo="/actions" title="Actions">
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
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
            Actions
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
      />
    </div>
  );
}
