import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { listSavedItems } from "@tendnote/db/queries/saved-items";
import { AppShell } from "@/components/app-shell";
import { SavedItemsSurface } from "@/components/saved-items-surface";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toSavedItemView } from "@/lib/saved-item-view";

export const dynamic = "force-dynamic";

export default async function SavedItemsPage() {
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/saved-items" });
  const [items, shareableMembers] = await Promise.all([
    listSavedItems({ callerUserId: ownerUserId, includeArchived: true }),
    listShareableHouseholdMembersForUser({ userId: ownerUserId }),
  ]);

  return (
    <AppShell ownerUserId={ownerUserId}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
            Saved Items
          </h1>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Notes, links, and open questions that do not have a better home yet. Private by default,
            grounded in what you originally captured.
          </p>
        </header>

        <SavedItemsSurface
          items={items.map((item) => toSavedItemView(item))}
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
