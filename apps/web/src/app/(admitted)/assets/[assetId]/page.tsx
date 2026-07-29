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
import { AssetDetailTabs } from "@/components/asset-detail-tabs";
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
import { LedgerList } from "@/components/person-ledger";
import { TabCount } from "@/components/tab-count";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TabsTrigger } from "@/components/ui/tabs";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toPendingAssetActionProposalView } from "@/lib/asset-action-proposal-view";
import { toAssetEvidenceView } from "@/lib/asset-evidence-view";
import { type AssetHistoryEntryView, toAssetHistoryEntryView } from "@/lib/asset-history-view";
import { toAssetPersonLinkView, toRelatedAssetLinkView } from "@/lib/asset-link-view";
import { formatAssetMemoryValue } from "@/lib/asset-memory-value";
import { toAssetRelatedActionView } from "@/lib/asset-related-action-view";
import type { AssetView } from "@/lib/asset-view";
import { appReturnTo } from "@/lib/auth/return-to";
import { getCachedAssetCoreView } from "@/lib/cache/asset-views";

/**
 * The Asset Profile (Phase 6 #197–#204): the coherent read home for one Asset — its core
 * metadata, visibility audience, and archive state, then the snapshot-backed summary and
 * everything the caller may know about it.
 *
 * The page itself stays a shell: identity header, lifecycle controls, then a tabbed
 * ledger. Everything below the header is grouped by the question being asked rather
 * than stacked into one long scroll, and each pane keeps its own Suspense boundary so
 * the panes stream in parallel - including into tabs that are not open yet.
 */
type AssetProfilePageProps = {
  params: Promise<{ assetId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type AssetRequest = { assetId: string; callerUserId: string };

/**
 * The per-tab badge counts, read once and awaited by each badge separately, so a
 * slow count never holds up the tab bar or a pane. Deliberately live rather than
 * cached: a badge that lies about what is behind a tab is worse than a late one.
 */
type AssetTabCounts = {
  memories: number;
  evidence: number;
  actions: number;
  links: number;
  people: number;
};

/**
 * `null` means the counts could not be read, which is deliberately not the same
 * value as "everything is zero". Badges are orientation and may degrade to
 * nothing, so a count store that is briefly unavailable must not take the
 * profile down with it. The permanent-delete confirmation reads the same
 * promise and treats the two apart - see {@link AssetRemoveStream}.
 */
export async function loadAssetTabCounts({
  assetId,
  callerUserId,
}: AssetRequest): Promise<AssetTabCounts | null> {
  try {
    const [memories, evidence, actions, links, people] = await Promise.all([
      listAssetMemories({ callerUserId, assetId }),
      listAssetEvidence({ callerUserId, assetId }),
      listLinkedGeneralActionsForAsset({ callerUserId, assetId }),
      listRelatedAssetLinks({ callerUserId, assetId }),
      listAssetPersonLinks({ callerUserId, assetId }),
    ]);
    return {
      memories: memories.length,
      evidence: evidence.length,
      actions: actions.length,
      links: links.length,
      people: people.length,
    };
  } catch {
    return null;
  }
}

/**
 * How many items in the shared Review Queue are still waiting on this asset, or
 * `null` when the queue could not be read - unknown, never "none pending".
 */
export async function loadAssetReviewItemCount({
  assetId,
  callerUserId,
}: AssetRequest): Promise<number | null> {
  try {
    return (await listAssetReviewGroups({ ownerUserId: callerUserId }))
      .filter((group) => group.asset.id === assetId)
      .reduce((count, group) => count + Number(group.assetPending) + group.memories.length, 0);
  } catch {
    return null;
  }
}

/** The derived story, read once and shared by the History pane and the Snapshot glance. */
async function loadAssetHistory({
  assetId,
  callerUserId,
}: AssetRequest): Promise<AssetHistoryEntryView[] | null> {
  try {
    const now = new Date();
    const entries = await listAssetHistory({ callerUserId, assetId });
    return entries.map((entry) => toAssetHistoryEntryView(entry, now));
  } catch {
    return null;
  }
}

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

  const request: AssetRequest = { assetId, callerUserId };
  // Started here and awaited in several places below. Each is a single read that
  // more than one boundary needs, so sharing the promise keeps the profile at
  // one query per question rather than one per component that asks it.
  const counts = loadAssetTabCounts(request);
  const history = loadAssetHistory(request);
  const reviewItems = view.owned ? loadAssetReviewItemCount(request) : null;

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

      <AssetProfilePanes
        counts={counts}
        history={history}
        request={request}
        reviewItems={reviewItems}
        view={view}
      />

      {view.owned ? (
        <Suspense fallback={null}>
          <AssetRemoveStream
            assetName={view.name}
            counts={counts}
            request={request}
            reviewItems={reviewItems}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/**
 * The profile's six panes, wired into the tab shell.
 *
 * Split from the page function because the two answer different questions: the
 * page resolves who is asking and starts the reads, and this composes the panes
 * over those promises. Keeping the composition out of the page is what lets the
 * access decision at the top of the page be read at a glance instead of scrolled
 * past.
 *
 * Every pane is its own Suspense boundary, so the tab shell paints before any
 * read lands and each section streams in when its own query resolves. Review is
 * the one conditional pane: `reviewItems` is null unless the caller owns the
 * asset, so the tab exists only when there is something behind it.
 */
function AssetProfilePanes({
  counts,
  history,
  request,
  reviewItems,
  view,
}: {
  counts: ReturnType<typeof loadAssetTabCounts>;
  history: ReturnType<typeof loadAssetHistory>;
  request: AssetRequest;
  reviewItems: ReturnType<typeof loadAssetReviewItemCount> | null;
  view: AssetView;
}) {
  return (
    <AssetDetailTabs
      actionsBadge={
        <Suspense fallback={null}>
          <AssetTabCountBadge counts={counts} of="actions" />
        </Suspense>
      }
      actionsPanel={
        <Suspense fallback={<AssetPaneReserve label="Related actions" />}>
          <AssetActionsStream request={request} view={view} />
        </Suspense>
      }
      connectionsBadge={
        <Suspense fallback={null}>
          <AssetTabCountBadge counts={counts} of="connections" />
        </Suspense>
      }
      connectionsPanel={
        <>
          <Suspense fallback={<AssetPaneReserve label="People" />}>
            <AssetPeopleStream request={request} view={view} />
          </Suspense>
          <Suspense fallback={<AssetPaneReserve label="Related assets" />}>
            <AssetLinksStream request={request} view={view} />
          </Suspense>
        </>
      }
      historyPanel={
        <Suspense fallback={<AssetPaneReserve label="History" />}>
          <AssetHistoryStream history={history} />
        </Suspense>
      }
      memoryBadge={
        <Suspense fallback={null}>
          <AssetTabCountBadge counts={counts} of="memories" />
        </Suspense>
      }
      memoryPanel={
        <>
          <Suspense fallback={<AssetPaneReserve label="Memories" />}>
            <AssetMemoriesStream request={request} />
          </Suspense>
          <Suspense fallback={<AssetPaneReserve label="Evidence" />}>
            <AssetEvidenceStream request={request} view={view} />
          </Suspense>
        </>
      }
      reviewPanel={
        reviewItems ? (
          <Suspense fallback={<AssetPaneReserve label="Review" />}>
            <AssetReviewPane reviewItems={reviewItems} />
          </Suspense>
        ) : null
      }
      reviewTrigger={
        reviewItems ? (
          <Suspense fallback={null}>
            <AssetReviewTabTrigger reviewItems={reviewItems} />
          </Suspense>
        ) : null
      }
      snapshotPanel={
        <>
          <Suspense fallback={<AssetPaneReserve label="Summary" />}>
            <AssetSummaryStream request={request} />
          </Suspense>
          <Suspense fallback={<AssetPaneReserve label="Latest" />}>
            <AssetLatestStream history={history} />
          </Suspense>
        </>
      }
    />
  );
}

/** Which tabs carry a count. Connections is composed, so it has no stored count. */
type AssetTabCountKey = "memories" | "actions" | "connections";

/**
 * One tab's count, awaited on its own so the tab bar paints immediately and each
 * number lands when its read does. Zero renders nothing: a tab with nothing in it
 * says so by having no badge, never by displaying a "0" to clear. A failed read
 * renders nothing either - a badge is orientation, and a wrong one is worse than
 * an absent one.
 */
async function AssetTabCountBadge({
  counts,
  of,
}: {
  counts: Promise<AssetTabCounts | null>;
  of: AssetTabCountKey;
}) {
  const resolved = await counts;
  if (!resolved) {
    return null;
  }

  return <TabCount count={assetTabCount(resolved, of)} />;
}

/**
 * Connections holds two panes - people and related assets - so its badge is the
 * sum of both rather than a key of {@link AssetTabCounts}.
 */
function assetTabCount(counts: AssetTabCounts, of: AssetTabCountKey): number {
  switch (of) {
    case "memories":
      return counts.memories;
    case "actions":
      return counts.actions;
    case "connections":
      return counts.people + counts.links;
  }
}

/** The Review tab, present only while the queue actually holds something for this asset. */
async function AssetReviewTabTrigger({ reviewItems }: { reviewItems: Promise<number | null> }) {
  const count = await reviewItems;
  if (!count) {
    return null;
  }

  return (
    <TabsTrigger className="group/tab" data-tab="review" value="review">
      Review
      <TabCount count={count} />
    </TabsTrigger>
  );
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

/**
 * The generated summary. It renders below the identity header and above nothing
 * that matters: every exact fact lives under Memory, which is real records.
 */
async function AssetSummaryStream({ request }: { request: AssetRequest }) {
  try {
    const props = toSnapshotCardProps(
      await getAssetSnapshot({ callerUserId: request.callerUserId, assetId: request.assetId }),
    );
    // The card renders nothing at all for a missing or stale snapshot, which is
    // right when it sits in a stack of sections and wrong when it is the landing
    // pane - so the pane says plainly that there is no summary yet.
    if (props.status === "fallback" || !props.summary?.trim()) {
      return (
        <EmptyState
          description="Tendnote writes one once there is enough here to summarize."
          size="compact"
          title="No summary yet."
        />
      );
    }
    return <AssetSnapshotCard {...props} />;
  } catch {
    return null;
  }
}

/**
 * The freshest signal: the single most recent moment in this asset's story, so the
 * landing pane answers "anything new?" without opening History for the full log.
 */
async function AssetLatestStream({
  history,
}: {
  history: Promise<AssetHistoryEntryView[] | null>;
}) {
  const entries = await history;
  if (!entries?.length) {
    return null;
  }

  return (
    <PanelSection description="The most recent thing that happened here." title="Latest">
      <AssetHistory entries={entries.slice(0, 1)} />
    </PanelSection>
  );
}

async function AssetMemoriesStream({ request }: { request: AssetRequest }) {
  try {
    return (
      <AssetMemoriesSection
        memories={
          await listAssetMemories({
            callerUserId: request.callerUserId,
            assetId: request.assetId,
          })
        }
      />
    );
  } catch {
    return <AssetPaneUnavailable label="Memories" />;
  }
}

async function AssetEvidenceStream({ request, view }: { request: AssetRequest; view: AssetView }) {
  const { assetId, callerUserId } = request;
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
      <PanelSection
        description="Receipts, manuals, photos, and links that ground what Tendnote remembers."
        id="evidence"
        title="Evidence"
      >
        <AssetEvidenceSection
          assetId={assetId}
          assetScope={view.scope}
          canCapture={view.owned && !view.archived}
          initialEvidence={evidence.map((record) => toAssetEvidenceView(record, { callerUserId }))}
          shareableMembers={shareableMembers}
        />
      </PanelSection>
    );
  } catch {
    return <AssetPaneUnavailable label="Evidence" />;
  }
}

async function AssetActionsStream({ request, view }: { request: AssetRequest; view: AssetView }) {
  const { assetId, callerUserId } = request;
  try {
    const [actions, proposals] = await Promise.all([
      listLinkedGeneralActionsForAsset({ callerUserId, assetId }),
      listPendingAssetActionProposals({ actorUserId: callerUserId, assetId }),
    ]);
    const now = new Date();
    return (
      <div className="flex flex-col gap-3">
        <PaneIntro>
          Reminders connected to this asset: replacements, renewals, maintenance.
        </PaneIntro>
        <AssetActionProposals
          assetId={assetId}
          canPropose={view.owned && !view.archived}
          proposals={proposals.map((entry) => toPendingAssetActionProposalView(entry, now))}
        />
        <AssetRelatedActions
          actions={actions.map((entry) => toAssetRelatedActionView(entry, now))}
        />
      </div>
    );
  } catch {
    return <AssetPaneUnavailable label="Related actions" />;
  }
}

async function AssetLinksStream({ request, view }: { request: AssetRequest; view: AssetView }) {
  const { assetId, callerUserId } = request;
  try {
    const [links, assets] = await Promise.all([
      listRelatedAssetLinks({ callerUserId, assetId }),
      listAssets({ callerUserId, statuses: ["active"] }),
    ]);
    return (
      <PanelSection
        description="What this fits, uses, replaces, covers, or is stored with."
        id="related-assets"
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
      </PanelSection>
    );
  } catch {
    return <AssetPaneUnavailable label="Related assets" />;
  }
}

async function AssetPeopleStream({ request, view }: { request: AssetRequest; view: AssetView }) {
  const { assetId, callerUserId } = request;
  try {
    const [links, people] = await Promise.all([
      listAssetPersonLinks({ callerUserId, assetId }),
      searchPeople({ ownerUserId: callerUserId, limit: 100 }),
    ]);
    return (
      <PanelSection
        description="Who recommended it, borrowed it, or services it. Linking a person never changes who can see this."
        id="people"
        title="People"
      >
        <AssetPersonLinks
          assetId={assetId}
          canLink={!view.archived}
          links={links.map((entry) => toAssetPersonLinkView(entry))}
          people={people.map((person) => ({ id: person.id, displayName: person.displayName }))}
        />
      </PanelSection>
    );
  } catch {
    return <AssetPaneUnavailable label="People" />;
  }
}

async function AssetHistoryStream({
  history,
}: {
  history: Promise<AssetHistoryEntryView[] | null>;
}) {
  const entries = await history;
  if (!entries) {
    return <AssetPaneUnavailable label="History" />;
  }
  return (
    <div className="flex flex-col gap-3">
      <PaneIntro>What happened to this asset over time.</PaneIntro>
      <AssetHistory entries={entries} />
    </div>
  );
}

/** Only rendered while something is pending: resolving it happens in Review itself. */
async function AssetReviewPane({ reviewItems }: { reviewItems: Promise<number | null> }) {
  const count = await reviewItems;
  if (!count) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <PaneIntro>
        {count === 1 ? "One suggestion is" : `${count} suggestions are`} waiting on this asset.
        Nothing is saved until you accept it.
      </PaneIntro>
      <Button asChild size="sm" variant="outline">
        <Link href="/review">Open Review</Link>
      </Button>
    </div>
  );
}

/**
 * The permanent-delete affordance, over the same reads the badges use.
 *
 * A count that could not be read arrives as `null`, and it is passed through as
 * `null` rather than folded into zero. `AssetRemove` waives its type-to-confirm
 * gate only for an asset with genuinely nothing saved in it, so a failed read
 * reported as zeros would turn permanent deletion of a full asset into one
 * click. Unknown stays unknown, and the dialog keeps the strict path.
 *
 * Neither promise can reject - each read catches its own failure and answers
 * `null` - so there is nothing here for a try/catch to catch.
 */
export async function AssetRemoveStream({
  assetName,
  counts,
  request,
  reviewItems,
}: {
  assetName: string;
  counts: Promise<AssetTabCounts | null>;
  request: AssetRequest;
  reviewItems: Promise<number | null> | null;
}) {
  const [resolved, pendingReview] = await Promise.all([counts, reviewItems ?? 0]);
  return (
    <AssetRemove
      assetId={request.assetId}
      assetName={assetName}
      summary={
        resolved && pendingReview !== null
          ? {
              memories: resolved.memories,
              evidence: resolved.evidence,
              reviewItems: pendingReview,
              linkedRecords: resolved.links + resolved.people,
            }
          : null
      }
    />
  );
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
      className="scroll-mt-32 flex flex-col gap-0.5 px-4 py-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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

/** The one line of purpose at the top of a pane that holds a single section. */
function PaneIntro({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[68ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
      {children}
    </p>
  );
}

/**
 * A section inside a tab pane. The tab label is this page's second-level heading,
 * so a pane's own sections sit a step below it at title size - Personal Ledger
 * density, one line of purpose, then content.
 */
function PanelSection({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description: string;
  /** Anchor for a hash deep link into this section of the pane. */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="scroll-mt-32 flex flex-col gap-2.5" id={id}>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-line)] tracking-normal">
          {title}
        </h3>
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
    <PanelSection
      description="Confirmed details worth keeping: model numbers, sizes, warranty dates."
      id="memories"
      title="Memories"
    >
      {memories.length > 0 ? (
        <LedgerList>
          {memories.map((memory) => (
            <AssetMemoryRow key={memory.id} memory={memory} />
          ))}
        </LedgerList>
      ) : (
        <EmptyState
          description="Details Tendnote confirms about this asset collect here."
          size="compact"
          title="Nothing remembered about this yet."
        />
      )}
    </PanelSection>
  );
}
