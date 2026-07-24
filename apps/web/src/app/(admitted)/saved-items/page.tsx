import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { connection } from "next/server";
import { AdmittedRoute } from "@/components/admitted-route";
import { SavedItemsSurface } from "@/components/saved-items-surface";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getCachedActiveSavedItemViews } from "@/lib/cache/asset-views";

export default function SavedItemsPage() {
  return (
    <AdmittedRoute returnTo="/saved-items" title="Saved Items">
      <SavedItemsContent />
    </AdmittedRoute>
  );
}

async function SavedItemsContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/saved-items" });
  const now = new Date();
  const [items, shareableMembers] = await Promise.all([
    getCachedActiveSavedItemViews({ callerUserId: ownerUserId, now }),
    listShareableHouseholdMembersForUser({ userId: ownerUserId }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
          Saved Items
        </h1>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Notes, links, and open questions that don't have a better home yet. Private by default.
        </p>
      </header>

      <SavedItemsSurface
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
