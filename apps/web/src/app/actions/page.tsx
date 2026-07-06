import {
  ensureDefaultGeneralActionAreas,
  listGeneralActionAreas,
} from "@tendnote/db/queries/general-action-areas";
import {
  listActiveGeneralActions,
  listResolvedGeneralActions,
} from "@tendnote/db/queries/general-actions";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { searchPeople } from "@tendnote/db/queries/people";
import { ActionsSurface } from "@/components/actions-surface";
import { AppShell } from "@/components/app-shell";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toGeneralActionAreaView } from "@/lib/general-action-area-view";
import { toGeneralActionView } from "@/lib/general-action-view";

// A calm cap on the resolved trail — enough to reopen a recent mistake, not a
// backlog to clear (DESIGN.md calm-by-default).
const RESOLVED_LIMIT = 20;

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const ownerUserId = await requireAdmittedOwner();
  const now = new Date();

  // Seed the owner's default Areas the first time they open Actions (idempotent),
  // then load every Area — archived included — so the surface can both drive the
  // filter (active only) and resolve names for Actions filed under a since-archived
  // Area.
  await ensureDefaultGeneralActionAreas({ ownerUserId });
  const [active, resolved, areas, shareableMembers, people] = await Promise.all([
    listActiveGeneralActions({ ownerUserId }),
    listResolvedGeneralActions({ ownerUserId, limit: RESOLVED_LIMIT }),
    listGeneralActionAreas({ ownerUserId, includeArchived: true }),
    // Members the owner can share an Action with — drives the visibility control.
    // Empty (no household) keeps the surface single-user and private-only.
    listShareableHouseholdMembersForUser({ userId: ownerUserId }),
    // The owner's people, so an Action can link one as context (ADR 0155).
    searchPeople({ ownerUserId, limit: 100 }),
  ]);

  const toView = (action: Parameters<typeof toGeneralActionView>[0]) =>
    toGeneralActionView(action, { now, callerUserId: ownerUserId });

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
            Actions
          </h1>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            One-time things to get done that aren't tied to a person — private by default, or shared
            with your household.
          </p>
        </header>

        <ActionsSurface
          active={active.map(toView)}
          areas={areas.map((area) => toGeneralActionAreaView(area))}
          people={people.map((person) => ({ id: person.id, displayName: person.displayName }))}
          resolved={resolved.map(toView)}
          resolvedTruncated={resolved.length >= RESOLVED_LIMIT}
          shareableMembers={shareableMembers.map((member) => ({
            userId: member.userId,
            name: member.name,
            email: member.email,
          }))}
        />
      </div>
    </AppShell>
  );
}
