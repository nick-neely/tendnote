import {
  getAsset,
  listAssetEvidence,
  listAssetHistory,
  listAssetMemories,
  listAssetPersonLinks,
  listAssets,
  listLinkedGeneralActionsForAsset,
  listPendingAssetActionProposals,
  listRelatedAssetLinks,
} from "@tendnote/db/queries/assets";
import { searchPeople } from "@tendnote/db/queries/people";
import type { AssetMemory } from "@tendnote/domain";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AssetActionProposals } from "@/components/asset-action-proposals";
import { AssetEvidenceSection } from "@/components/asset-evidence-section";
import { AssetHistory } from "@/components/asset-history";
import { AssetPersonLinks } from "@/components/asset-person-links";
import { AssetProfileControls } from "@/components/asset-profile-controls";
import { AssetRelatedActions } from "@/components/asset-related-actions";
import { AssetRelatedLinks } from "@/components/asset-related-links";
import { ASSET_KIND_ICONS, AssetArchivedBadge } from "@/components/asset-shared";
import { ActionScopeChip } from "@/components/general-action-shared";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toPendingAssetActionProposalView } from "@/lib/asset-action-proposal-view";
import { toAssetEvidenceView } from "@/lib/asset-evidence-view";
import { toAssetHistoryEntryView } from "@/lib/asset-history-view";
import { toAssetPersonLinkView, toRelatedAssetLinkView } from "@/lib/asset-link-view";
import { formatAssetMemoryValue } from "@/lib/asset-memory-value";
import { toAssetRelatedActionView } from "@/lib/asset-related-action-view";
import { type AssetView, toAssetView } from "@/lib/asset-view";

export const dynamic = "force-dynamic";

/**
 * The Asset Profile (Phase 6 #197–#202): the coherent read home for one Asset —
 * its core metadata, visibility audience, and archive state, then everything the
 * caller may know about it: reviewed memories, captured evidence, related
 * General Actions, lightweight Related Asset Links and Person Links, and the
 * derived Asset History. Every section is filtered per record for this caller.
 * Deterministic denial is a plain 404 — a non-visible asset and a missing one
 * are indistinguishable (ADR 0153).
 */
/**
 * Everything this caller may see about one Asset, already projected to views. Each read
 * is filtered per record, so a household Asset can carry a private detail, receipt,
 * action, link, or person its members never see (#198–#203). Kept beside the page rather
 * than inside it so the component stays a layout — the reads and their projections are
 * one concern, and the JSX is another.
 */
async function loadAssetProfile(callerUserId: string, assetId: string) {
  const asset = await getAsset({ callerUserId, assetId });
  if (!asset) {
    return null;
  }

  const [
    memories,
    evidence,
    relatedActions,
    pendingActionProposals,
    relatedLinks,
    personLinks,
    history,
    visibleAssets,
    people,
  ] = await Promise.all([
    listAssetMemories({ callerUserId, assetId }),
    listAssetEvidence({ callerUserId, assetId }),
    listLinkedGeneralActionsForAsset({ callerUserId, assetId }),
    // Review state, so owner-only and never a co-member's to see (#203).
    listPendingAssetActionProposals({ actorUserId: callerUserId, assetId }),
    listRelatedAssetLinks({ callerUserId, assetId }),
    listAssetPersonLinks({ callerUserId, assetId }),
    listAssetHistory({ callerUserId, assetId }),
    // Link candidates: the active assets this caller can see (self excluded below).
    listAssets({ callerUserId, statuses: ["active"] }),
    // The caller's own people, for contextual person links.
    searchPeople({ ownerUserId: callerUserId, limit: 100 }),
  ]);

  const now = new Date();
  const view = toAssetView(asset, { callerUserId });
  return {
    memories,
    people,
    view,
    // Proposing reminders is owner-only review state, and pointless on an archived
    // asset — a sold car should not be proposing oil changes (#203).
    canPropose: view.owned && !view.archived,
    // Links are context anyone who can see the asset may add — while it's active.
    canLink: !view.archived,
    evidenceViews: evidence.map((record) => toAssetEvidenceView(record, { callerUserId })),
    relatedActionViews: relatedActions.map((entry) => toAssetRelatedActionView(entry, now)),
    proposalViews: pendingActionProposals.map((entry) =>
      toPendingAssetActionProposalView(entry, now),
    ),
    relatedLinkViews: relatedLinks.map((entry) => toRelatedAssetLinkView(entry)),
    personLinkViews: personLinks.map((entry) => toAssetPersonLinkView(entry)),
    historyViews: history.map((entry) => toAssetHistoryEntryView(entry, now)),
    linkableAssets: visibleAssets
      .filter((candidate) => candidate.id !== assetId)
      .map((candidate) => ({ id: candidate.id, name: candidate.name })),
  };
}

export default async function AssetProfilePage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const callerUserId = await requireAdmittedOwner();

  const profile = await loadAssetProfile(callerUserId, assetId);
  if (!profile) {
    notFound();
  }

  const {
    memories,
    people,
    view,
    canPropose,
    canLink,
    evidenceViews,
    relatedActionViews,
    proposalViews,
    relatedLinkViews,
    personLinkViews,
    historyViews,
    linkableAssets,
  } = profile;

  return (
    <AppShell>
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

        <ProfileSection
          description="Confirmed details worth keeping — model numbers, sizes, warranty dates."
          title="Memories"
        >
          {memories.length > 0 ? (
            <LedgerList>
              {memories.map((memory) => (
                <AssetMemoryRow key={memory.id} memory={memory} />
              ))}
            </LedgerList>
          ) : (
            <LedgerEmpty>
              Nothing remembered about this yet. The details you confirm will live here.
            </LedgerEmpty>
          )}
        </ProfileSection>

        <ProfileSection
          description="Receipts, manuals, photos, and links that ground what Tendnote remembers."
          title="Evidence"
        >
          <AssetEvidenceSection
            assetId={assetId}
            assetScope={view.scope}
            canCapture={view.owned && !view.archived}
            initialEvidence={evidenceViews}
          />
        </ProfileSection>

        <ProfileSection
          description="Reminders connected to this asset — replacements, renewals, maintenance."
          title="Related actions"
        >
          {/* Proposals first, above the ledger of real ones: they are the only thing here
              waiting on the owner, and once accepted they simply join the list below. */}
          <AssetActionProposals
            assetId={assetId}
            canPropose={canPropose}
            proposals={proposalViews}
          />
          <AssetRelatedActions actions={relatedActionViews} />
        </ProfileSection>

        <ProfileSection
          description="What this fits, uses, replaces, covers, or is stored with — context, not a hierarchy."
          title="Related assets"
        >
          <AssetRelatedLinks
            assetId={assetId}
            canLink={canLink}
            linkableAssets={linkableAssets}
            links={relatedLinkViews}
          />
        </ProfileSection>

        <ProfileSection
          description="Who recommended it, borrowed it, or services it — context that never changes who can see this."
          title="People"
        >
          <AssetPersonLinks
            assetId={assetId}
            canLink={canLink}
            links={personLinkViews}
            people={people.map((person) => ({ id: person.id, displayName: person.displayName }))}
          />
        </ProfileSection>

        <ProfileSection
          description="What happened over time — drawn from this asset's own story, its confirmed details, and its related actions."
          title="History"
        >
          <AssetHistory entries={historyViews} />
        </ProfileSection>
      </div>
    </AppShell>
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
        <h1 className="text-[length:var(--text-display)] font-semibold leading-[var(--text-display-line)] tracking-normal text-balance">
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
      {view.archivedLabel ?? "This asset is archived"} — it keeps its history and stays out of
      active views until you restore it.
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
    <div className="flex flex-col gap-0.5 px-4 py-3">
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
