import { listLinkedAssetsForGeneralActions } from "@tendnote/db/queries/assets";
import {
  ensureDefaultGeneralActionAreas,
  listGeneralActionAreas,
} from "@tendnote/db/queries/general-action-areas";
import {
  listActiveGeneralActions,
  listPausedGeneralActions,
  listResolvedGeneralActions,
  listSuggestedGeneralActionReviews,
} from "@tendnote/db/queries/general-actions";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { searchPeople } from "@tendnote/db/queries/people";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import Link from "next/link";
import { ActionsSurface } from "@/components/actions-surface";
import { AppShell } from "@/components/app-shell";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toGeneralActionAreaView } from "@/lib/general-action-area-view";
import { toGeneralActionLinkedAssetView, toGeneralActionView } from "@/lib/general-action-view";
import { toSuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";

// A calm cap on the resolved trail — enough to reopen a recent mistake, not a
// backlog to clear (DESIGN.md calm-by-default).
const RESOLVED_LIMIT = 20;

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/actions" });
  const now = new Date();

  // Seed the owner's default Areas the first time they open Actions (idempotent),
  // then load every Area — archived included — so the surface can both drive the
  // filter (active only) and resolve names for Actions filed under a since-archived
  // Area.
  await ensureDefaultGeneralActionAreas({ ownerUserId });
  const [active, paused, resolved, suggested, areas, shareableMembers, people, reminderSchedules] =
    await Promise.all([
      listActiveGeneralActions({ ownerUserId }),
      // Paused Routines, kept reachable to resume or retire — never on a proactive
      // surface, so a paused Routine stays quiet (ADR 0148).
      listPausedGeneralActions({ ownerUserId }),
      listResolvedGeneralActions({ ownerUserId, limit: RESOLVED_LIMIT }),
      // Review-gated Suggested actions, shown in their own section above the ledger and
      // in the shared Review Queue (ADR 0152).
      listSuggestedGeneralActionReviews({ ownerUserId }),
      listGeneralActionAreas({ ownerUserId, includeArchived: true }),
      // Members the owner can share an Action with — drives the visibility control.
      // Empty (no household) keeps the surface single-user and private-only.
      listShareableHouseholdMembersForUser({ userId: ownerUserId }),
      // The owner's people, so an Action can link one as context (ADR 0155).
      searchPeople({ ownerUserId, limit: 100 }),
      listReminderSchedulesForOwner({ ownerUserId }),
    ]);

  const areaNameById = new Map(areas.map((area) => [area.id, area.name]));
  const reminderScheduleByActionId = new Map(
    reminderSchedules.map((schedule) => [schedule.generalActionId, schedule]),
  );

  // The Assets these actions' hints became (#199) — one batched read, filtered
  // per record for this caller, so the rows can pair hint chips with real Assets.
  const linkedAssetsByAction = await listLinkedAssetsForGeneralActions({
    callerUserId: ownerUserId,
    generalActionIds: [...active, ...paused, ...resolved].map((action) => action.id),
  });
  const toView = (action: Parameters<typeof toGeneralActionView>[0]) =>
    toGeneralActionView(action, {
      now,
      callerUserId: ownerUserId,
      linkedAssets: (linkedAssetsByAction[action.id] ?? []).map(toGeneralActionLinkedAssetView),
      reminderSchedule: reminderScheduleByActionId.get(action.id) ?? null,
    });

  return (
    <AppShell ownerUserId={ownerUserId}>
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
          active={active.map(toView)}
          areas={areas.map((area) => toGeneralActionAreaView(area))}
          paused={paused.map(toView)}
          people={people.map((person) => ({ id: person.id, displayName: person.displayName }))}
          resolved={resolved.map(toView)}
          resolvedTruncated={resolved.length >= RESOLVED_LIMIT}
          shareableMembers={shareableMembers.map((member) => ({
            userId: member.userId,
            name: member.name,
            email: member.email,
          }))}
          suggested={suggested.map((review) =>
            toSuggestedGeneralActionReviewView(review, {
              now,
              callerUserId: ownerUserId,
              areaNameById,
            }),
          )}
        />
      </div>
    </AppShell>
  );
}
