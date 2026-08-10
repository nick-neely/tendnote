import {
  listActiveHouseholdMembershipsForUser,
  listShareableHouseholdMembersForUser,
} from "@tendnote/db/queries/households";
import { connection } from "next/server";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { SavedItemsSurface } from "@/components/saved-items-surface";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getCachedActiveSavedItemViews } from "@/lib/cache/asset-views";

export default function SavedItemsPage() {
  return (
    <AdmittedRoute destination="saved-items">
      <SavedItemsContent />
    </AdmittedRoute>
  );
}

async function SavedItemsContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/saved-items" });
  const now = new Date();
  const [items, shareableMembers, memberships] = await Promise.all([
    getCachedActiveSavedItemViews({ callerUserId: ownerUserId, now }),
    listShareableHouseholdMembersForUser({ userId: ownerUserId }),
    // Read apart from the shareable members: a solo Household Workspace has a
    // household to save into and nobody to share with, and offering the
    // household destination only when someone else is already there would hide
    // it exactly when a member is setting the workspace up.
    listActiveHouseholdMembershipsForUser({ userId: ownerUserId }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
          {appDestination("saved-items").label}
        </h1>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Notes, links, and open questions that don't have a better home yet. Private by default.
        </p>
      </header>

      <SavedItemsSurface
        hasHousehold={memberships.length > 0}
        items={items}
        shareableMembers={shareableMembers.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
        }))}
      />
    </div>
  );
}
