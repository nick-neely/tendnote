import { getAssetSnapshot } from "@tendnote/db/queries/asset-snapshots";
import {
  getAsset,
  listAssetEvidence,
  listAssetHistory,
  listAssetMemories,
  listAssetPersonLinks,
  listAssetReviewGroups,
  listAssets,
  listLinkedGeneralActionsForAsset,
  listPendingAssetActionProposals,
  listRelatedAssetLinks,
} from "@tendnote/db/queries/assets";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { searchPeople } from "@tendnote/db/queries/people";
import type { AssetMemory, AssetSnapshotSupportingReferences } from "@tendnote/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdmittedRoute } from "@/components/admitted-route";
import { AssetActionProposals } from "@/components/asset-action-proposals";
import { AssetEvidenceSection } from "@/components/asset-evidence-section";
import { AssetHistory } from "@/components/asset-history";
import { AssetPersonLinks } from "@/components/asset-person-links";
import { AssetProfileControls } from "@/components/asset-profile-controls";
import { AssetRelatedActions } from "@/components/asset-related-actions";
import { AssetRelatedLinks } from "@/components/asset-related-links";
import { AssetRemove } from "@/components/asset-remove";
import { ASSET_KIND_ICONS, AssetArchivedBadge } from "@/components/asset-shared";
import { AssetSnapshotCard, type AssetSnapshotCardProps } from "@/components/asset-snapshot-card";
import { ActionScopeChip } from "@/components/general-action-shared";
import { ArrowLeftIcon } from "@/components/icons";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toPendingAssetActionProposalView } from "@/lib/asset-action-proposal-view";
import { toAssetEvidenceView } from "@/lib/asset-evidence-view";
import { toAssetHistoryEntryView } from "@/lib/asset-history-view";
import { toAssetPersonLinkView, toRelatedAssetLinkView } from "@/lib/asset-link-view";
import { formatAssetMemoryValue } from "@/lib/asset-memory-value";
import { toAssetRelatedActionView } from "@/lib/asset-related-action-view";
import type { AssetView } from "@/lib/asset-view";
import { appReturnTo } from "@/lib/auth/return-to";
import { getCachedAssetCoreView } from "@/lib/cache/asset-views";

/**
 * The Asset Profile (Phase 6 #197–#204): the coherent read home for one Asset — its core
 * metadata, visibility audience, and archive state, then the snapshot-backed summary and
 * everything the caller may know about it. The page itself stays a shell: header,
 * snapshot, sections.
 */
type AssetProfilePageProps = {
  params: Promise<{ assetId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default function AssetProfilePage(props: AssetProfilePageProps) {
  return (
    <AdmittedRoute destination="asset">
      <AssetProfileContent {...props} />
    </AdmittedRoute>
  );
}

async function AssetProfileContent({ params, searchParams }: AssetProfilePageProps) {
  if (process.env.NODE_ENV !== "test") await connection();
  const [{ assetId }, query] = await Promise.all([params, searchParams]);
  const callerUserId = await requireAdmittedOwner({
    returnTo: appReturnTo(`/assets/${encodeURIComponent(assetId)}`, query),
  });

  const view = await getCachedAssetCoreView({
    assetId,
    callerUserId,
    now: new Date(),
  });
  if (!view) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[length:var(--text-small)] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href="/assets"
      >
        <ArrowLeftIcon aria-hidden className="size-3.5" />
        Assets
      </Link>

      <AssetProfileHeader view={view} />

      <ArchivedNote view={view} />

      <AssetProfileControls asset={view} />

      <Suspense fallback={<AssetPaneReserve label="Asset details" />}>
        <AssetProfileCountsStream assetId={assetId} callerUserId={callerUserId} />
      </Suspense>

      <AssetProfileDeferredContent assetId={assetId} callerUserId={callerUserId} view={view} />
    </div>
  );
}

function AssetProfileDeferredContent({
  assetId,
  callerUserId,
  view,
}: {
  assetId: string;
  callerUserId: string;
  view: AssetView;
}) {
  return (
    <>
      <Suspense fallback={<AssetPaneReserve label="Snapshot" />}>
        <AssetSnapshotStream assetId={assetId} callerUserId={callerUserId} />
      </Suspense>
      <Suspense fallback={<AssetPaneReserve label="Memories" />}>
        <AssetMemoriesStream assetId={assetId} callerUserId={callerUserId} />
      </Suspense>
      <Suspense fallback={<AssetPaneReserve label="Evidence" />}>
        <AssetEvidenceStream assetId={assetId} callerUserId={callerUserId} view={view} />
      </Suspense>
      <Suspense fallback={<AssetPaneReserve label="Related actions" />}>
        <AssetActionsStream assetId={assetId} callerUserId={callerUserId} view={view} />
      </Suspense>
      <Suspense fallback={<AssetPaneReserve label="Related assets" />}>
        <AssetLinksStream assetId={assetId} callerUserId={callerUserId} view={view} />
      </Suspense>
      <Suspense fallback={<AssetPaneReserve label="People" />}>
        <AssetPeopleStream assetId={assetId} callerUserId={callerUserId} view={view} />
      </Suspense>
      <Suspense fallback={<AssetPaneReserve label="History" />}>
        <AssetHistoryStream assetId={assetId} callerUserId={callerUserId} />
      </Suspense>
      {view.owned ? (
        <Suspense fallback={<AssetPaneReserve label="Review" />}>
          <AssetReviewStream assetId={assetId} callerUserId={callerUserId} />
        </Suspense>
      ) : null}
      {view.owned ? (
        <Suspense fallback={null}>
          <AssetRemoveStream assetId={assetId} assetName={view.name} callerUserId={callerUserId} />
        </Suspense>
      ) : null}
    </>
  );
}

/** Counts are scoped reads, kept distinct from the richer pane payloads below. */
async function AssetProfileCountsStream({
  assetId,
  callerUserId,
}: {
  assetId: string;
  callerUserId: string;
}) {
  try {
    const [memories, evidence, actions, links, people] = await Promise.all([
      listAssetMemories({ callerUserId, assetId }),
      listAssetEvidence({ callerUserId, assetId }),
      listLinkedGeneralActionsForAsset({ callerUserId, assetId }),
      listRelatedAssetLinks({ callerUserId, assetId }),
      listAssetPersonLinks({ callerUserId, assetId }),
    ]);
    const counts = [
      ["Memories", memories.length],
      ["Evidence", evidence.length],
      ["Actions", actions.length],
      ["Links", links.length],
      ["People", people.length],
    ] as const;
    return (
      <section aria-label="Asset details" className="rounded-xl border bg-surface px-4 py-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
          {counts.map(([label, count]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{count}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  } catch {
    return <AssetPaneUnavailable label="Asset details" />;
  }
}

function AssetPaneReserve({ label }: { label: string }) {
  return (
    <section
      aria-busy="true"
      aria-label={label}
      className="rounded-xl border border-dashed px-4 py-5"
    >
      <p className="text-[length:var(--text-small)] text-muted-foreground">Loading {label}…</p>
    </section>
  );
}

async function AssetSnapshotStream({
  assetId,
  callerUserId,
}: {
  assetId: string;
  callerUserId: string;
}) {
  try {
    return (
      <AssetSnapshotCard
        {...toSnapshotCardProps(await getAssetSnapshot({ callerUserId, assetId }))}
      />
    );
  } catch {
    return null;
  }
}

async function AssetMemoriesStream({
  assetId,
  callerUserId,
}: {
  assetId: string;
  callerUserId: string;
}) {
  try {
    return <AssetMemoriesSection memories={await listAssetMemories({ callerUserId, assetId })} />;
  } catch {
    return <AssetPaneUnavailable label="Memories" />;
  }
}

async function AssetEvidenceStream({
  assetId,
  callerUserId,
  view,
}: {
  assetId: string;
  callerUserId: string;
  view: AssetView;
}) {
  try {
    const [asset, evidence, members] = await Promise.all([
      getAsset({ callerUserId, assetId }),
      listAssetEvidence({ callerUserId, assetId }),
      listShareableHouseholdMembersForUser({ userId: callerUserId }),
    ]);
    if (!asset) return null;
    const audience = new Set([asset.ownerUserId, ...asset.sharedWithUserIds]);
    const shareableMembers = (
      asset.scope === "shared" ? members.filter((member) => audience.has(member.userId)) : members
    ).map((member) => ({ userId: member.userId, name: member.name, email: member.email }));
    return (
      <ProfileSection
        description="Receipts, manuals, photos, and links that ground what Tendnote remembers."
        title="Evidence"
      >
        <AssetEvidenceSection
          assetId={assetId}
          assetScope={view.scope}
          canCapture={view.owned && !view.archived}
          initialEvidence={evidence.map((record) => toAssetEvidenceView(record, { callerUserId }))}
          shareableMembers={shareableMembers}
        />
      </ProfileSection>
    );
  } catch {
    return <AssetPaneUnavailable label="Evidence" />;
  }
}

async function AssetActionsStream({
  assetId,
  callerUserId,
  view,
}: {
  assetId: string;
  callerUserId: string;
  view: AssetView;
}) {
  try {
    const [actions, proposals] = await Promise.all([
      listLinkedGeneralActionsForAsset({ callerUserId, assetId }),
      listPendingAssetActionProposals({ actorUserId: callerUserId, assetId }),
    ]);
    const now = new Date();
    return (
      <ProfileSection
        description="Reminders connected to this asset: replacements, renewals, maintenance."
        title="Related actions"
      >
        <AssetActionProposals
          assetId={assetId}
          canPropose={view.owned && !view.archived}
          proposals={proposals.map((entry) => toPendingAssetActionProposalView(entry, now))}
        />
        <AssetRelatedActions
          actions={actions.map((entry) => toAssetRelatedActionView(entry, now))}
        />
      </ProfileSection>
    );
  } catch {
    return <AssetPaneUnavailable label="Related actions" />;
  }
}

async function AssetLinksStream({
  assetId,
  callerUserId,
  view,
}: {
  assetId: string;
  callerUserId: string;
  view: AssetView;
}) {
  try {
    const [links, assets] = await Promise.all([
      listRelatedAssetLinks({ callerUserId, assetId }),
      listAssets({ callerUserId, statuses: ["active"] }),
    ]);
    return (
      <ProfileSection
        description="What this fits, uses, replaces, covers, or is stored with."
        title="Related assets"
      >
        <AssetRelatedLinks
          assetId={assetId}
          canLink={!view.archived}
          linkableAssets={assets
            .filter((asset) => asset.id !== assetId)
            .map((asset) => ({ id: asset.id, name: asset.name }))}
          links={links.map((entry) => toRelatedAssetLinkView(entry))}
        />
      </ProfileSection>
    );
  } catch {
    return <AssetPaneUnavailable label="Related assets" />;
  }
}

async function AssetPeopleStream({
  assetId,
  callerUserId,
  view,
}: {
  assetId: string;
  callerUserId: string;
  view: AssetView;
}) {
  try {
    const [links, people] = await Promise.all([
      listAssetPersonLinks({ callerUserId, assetId }),
      searchPeople({ ownerUserId: callerUserId, limit: 100 }),
    ]);
    return (
      <ProfileSection
        description="Who recommended it, borrowed it, or services it. Linking a person never changes who can see this."
        title="People"
      >
        <AssetPersonLinks
          assetId={assetId}
          canLink={!view.archived}
          links={links.map((entry) => toAssetPersonLinkView(entry))}
          people={people.map((person) => ({ id: person.id, displayName: person.displayName }))}
        />
      </ProfileSection>
    );
  } catch {
    return <AssetPaneUnavailable label="People" />;
  }
}

async function AssetHistoryStream({
  assetId,
  callerUserId,
}: {
  assetId: string;
  callerUserId: string;
}) {
  try {
    const now = new Date();
    const entries = await listAssetHistory({ callerUserId, assetId });
    return (
      <ProfileSection description="What happened to this asset over time." title="History">
        <AssetHistory entries={entries.map((entry) => toAssetHistoryEntryView(entry, now))} />
      </ProfileSection>
    );
  } catch {
    return <AssetPaneUnavailable label="History" />;
  }
}

async function AssetReviewStream({
  assetId,
  callerUserId,
}: {
  assetId: string;
  callerUserId: string;
}) {
  try {
    const reviewItemCount = (await listAssetReviewGroups({ ownerUserId: callerUserId }))
      .filter((group) => group.asset.id === assetId)
      .reduce((count, group) => count + Number(group.assetPending) + group.memories.length, 0);
    return (
      <ProfileSection
        description={
          reviewItemCount
            ? `${reviewItemCount} pending item${reviewItemCount === 1 ? "" : "s"} need attention.`
            : "No pending review items for this asset."
        }
        title="Review"
      >
        {reviewItemCount ? <Link href="/review">Open Review</Link> : null}
      </ProfileSection>
    );
  } catch {
    return <AssetPaneUnavailable label="Review" />;
  }
}

async function AssetRemoveStream({
  assetId,
  assetName,
  callerUserId,
}: {
  assetId: string;
  assetName: string;
  callerUserId: string;
}) {
  try {
    const [memories, evidence, proposals, links, people] = await Promise.all([
      listAssetMemories({ callerUserId, assetId }),
      listAssetEvidence({ callerUserId, assetId }),
      listAssetReviewGroups({ ownerUserId: callerUserId }),
      listRelatedAssetLinks({ callerUserId, assetId }),
      listAssetPersonLinks({ callerUserId, assetId }),
    ]);
    const reviewItems = proposals
      .filter((group) => group.asset.id === assetId)
      .reduce((count, group) => count + Number(group.assetPending) + group.memories.length, 0);
    return (
      <AssetRemove
        assetId={assetId}
        assetName={assetName}
        summary={{
          memories: memories.length,
          evidence: evidence.length,
          reviewItems,
          linkedRecords: links.length + people.length,
        }}
      />
    );
  } catch {
    return null;
  }
}

function AssetPaneUnavailable({ label }: { label: string }) {
  return (
    <section aria-label={label} className="rounded-xl border border-dashed px-4 py-3">
      <p className="text-[length:var(--text-small)] text-muted-foreground">
        {label} are unavailable right now. Try refreshing this page.
      </p>
    </section>
  );
}

/** Kind glyph, name, provenance line, and — only when it says something — scope/archive chips. */
function AssetProfileHeader({ view }: { view: AssetView }) {
  const KindIcon = ASSET_KIND_ICONS[view.kind];
  return (
    <header className="flex items-start gap-4">
      <span
        aria-hidden
        className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
      >
        <KindIcon className="size-6" />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
        <h1 className="font-display text-[length:var(--text-display)] font-semibold leading-[var(--text-display-line)] tracking-normal text-balance">
          {view.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {view.kindLabel} · {view.addedLabel}
        </p>
        {view.scope !== "private" || view.archived ? (
          <div className="flex flex-wrap items-center gap-2">
            <ActionScopeChip label={view.visibilityLabel} scope={view.scope} />
            {view.archived ? <AssetArchivedBadge /> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** The calm archived note: when it happened and that restoring brings it back. */
function ArchivedNote({ view }: { view: AssetView }) {
  if (!view.archived) {
    return null;
  }
  return (
    <p className="max-w-[68ch] rounded-xl border border-dashed px-4 py-3 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
      {view.archivedLabel ?? "This asset is archived"}. It keeps its history and stays out of active
      views until you restore it.
    </p>
  );
}

/**
 * One reviewed Asset Memory: the fact's name in quiet mono, the exact value in
 * ink, freeform notes underneath — Personal Ledger density, human content first.
 */
function AssetMemoryRow({ memory }: { memory: AssetMemory }) {
  const valueLabel = formatAssetMemoryValue(memory.value);
  return (
    <div
      className="scroll-mt-20 flex flex-col gap-0.5 px-4 py-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      id={`asset-memory-${memory.id}`}
      tabIndex={-1}
    >
      <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
        {memory.label}
      </span>
      {valueLabel ? (
        <span className="font-medium text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {valueLabel}
        </span>
      ) : null}
      {memory.notes ? (
        <p className="max-w-[68ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {memory.notes}
        </p>
      ) : null}
    </div>
  );
}

/** A quiet Personal Ledger section: heading, one line of purpose, then content. */
function ProfileSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[length:var(--text-h2)] font-semibold leading-[var(--text-h2-line)] tracking-normal">
          {title}
        </h2>
        <p className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

/**
 * The snapshot card's props, derived in one place. `citationCount` is what turns
 * "generated summary" from a disclaimer into a fact the user can check: it is the number
 * of real records the prose was built from.
 */
function toSnapshotCardProps(
  snapshot: Awaited<ReturnType<typeof getAssetSnapshot>>,
): AssetSnapshotCardProps {
  return {
    status: snapshot.status,
    summary: snapshot.snapshot?.summary ?? null,
    citationCount: countSnapshotCitations(snapshot.snapshot?.supportingReferences),
  };
}

function countSnapshotCitations(references: AssetSnapshotSupportingReferences | undefined): number {
  if (!references) {
    return 0;
  }

  return (
    references.assetMemoryIds.length +
    references.assetEvidenceIds.length +
    references.relatedAssetLinkIds.length +
    references.assetPersonLinkIds.length +
    references.generalActionIds.length
  );
}

/** The reviewed facts: the confirmed details this asset is actually known by. */
function AssetMemoriesSection({ memories }: { memories: AssetMemory[] }) {
  return (
    <ProfileSection
      description="Confirmed details worth keeping: model numbers, sizes, warranty dates."
      title="Memories"
    >
      {memories.length > 0 ? (
        <LedgerList>
          {memories.map((memory) => (
            <AssetMemoryRow key={memory.id} memory={memory} />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>Nothing remembered about this yet.</LedgerEmpty>
      )}
    </ProfileSection>
  );
}
