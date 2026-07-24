import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { connection } from "next/server";
import { browseAssetsAction, searchAssetsAction } from "@/app/actions/assets";
import { AdmittedRoute } from "@/components/admitted-route";
import { AssetsSurface } from "@/components/assets-surface";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getCachedDefaultAssetViews } from "@/lib/cache/asset-views";

export default function AssetsPage() {
  return (
    <AdmittedRoute returnTo="/assets" title="Assets">
      <AssetsContent />
    </AdmittedRoute>
  );
}

async function AssetsContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/assets" });
  const now = new Date();

  // The default Active ledger is cached; archival, filtering, and pagination stay
  // server-backed after explicit interaction so this common path remains bounded.
  const [page, shareableMembers] = await Promise.all([
    getCachedDefaultAssetViews({ callerUserId: ownerUserId, now }),
    // Members the owner can share an Asset with — drives the visibility control.
    // Empty (no household) keeps the surface single-user and private-only.
    listShareableHouseholdMembersForUser({ userId: ownerUserId }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
          Assets
        </h1>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The practical things you keep track of: appliances, vehicles, subscriptions. Private by
          default, or shared with your household.
        </p>
      </header>

      <AssetsSurface
        browse={browseAssetsAction}
        search={searchAssetsAction}
        assets={page.assets}
        nextOffset={page.nextOffset}
        reviewCount={page.reviewCount}
        shareableMembers={shareableMembers.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
        }))}
      />
    </div>
  );
}
