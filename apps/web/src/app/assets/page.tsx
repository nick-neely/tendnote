import { listAssets } from "@tendnote/db/queries/assets";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { searchAssetsAction } from "@/app/actions/assets";
import { AppShell } from "@/components/app-shell";
import { AssetsSurface } from "@/components/assets-surface";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toAssetView } from "@/lib/asset-view";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const ownerUserId = await requireAdmittedOwner();
  const now = new Date();

  // All lifecycle states load together: the surface defaults to Active and keeps
  // archived assets one calm filter chip away rather than a separate fetch.
  const [assets, shareableMembers] = await Promise.all([
    listAssets({ callerUserId: ownerUserId }),
    // Members the owner can share an Asset with — drives the visibility control.
    // Empty (no household) keeps the surface single-user and private-only.
    listShareableHouseholdMembersForUser({ userId: ownerUserId }),
  ]);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
            Assets
          </h1>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The practical things you keep track of — appliances, vehicles, subscriptions — private
            by default, or shared with your household.
          </p>
        </header>

        <AssetsSurface
          search={searchAssetsAction}
          assets={assets.map((asset) => toAssetView(asset, { callerUserId: ownerUserId, now }))}
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
