import { getAsset, listAssetMemories } from "@tendnote/db/queries/assets";
import type { AssetMemory } from "@tendnote/domain";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AssetProfileControls } from "@/components/asset-profile-controls";
import { ASSET_KIND_ICONS, AssetArchivedBadge } from "@/components/asset-shared";
import { ActionScopeChip } from "@/components/general-action-shared";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { formatAssetMemoryValue } from "@/lib/asset-memory-value";
import { type AssetView, toAssetView } from "@/lib/asset-view";

export const dynamic = "force-dynamic";

/**
 * The minimal Asset Profile (Phase 6 #197): the asset's core metadata, visibility
 * audience, and archive state, plus quiet placeholder sections where memories,
 * evidence, and related actions will attach in later slices. Deterministic denial
 * is a plain 404 — a non-visible asset and a missing one are indistinguishable
 * (ADR 0153).
 */
export default async function AssetProfilePage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const callerUserId = await requireAdmittedOwner();

  const asset = await getAsset({ callerUserId, assetId });
  if (!asset) {
    notFound();
  }

  // The reviewed details this caller may see — filtered per record, so a
  // household asset can carry a private detail its members never see (#198).
  const memories = await listAssetMemories({ callerUserId, assetId });
  const view = toAssetView(asset, { callerUserId });

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
          <LedgerEmpty>No receipts, manuals, or photos attached yet.</LedgerEmpty>
        </ProfileSection>

        <ProfileSection
          description="Reminders connected to this asset — replacements, renewals, maintenance."
          title="Related actions"
        >
          <LedgerEmpty>No related actions yet.</LedgerEmpty>
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
