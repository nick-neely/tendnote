import { SparklesIcon } from "lucide-react";

export type AssetSnapshotCardProps = {
  /** How the snapshot was produced. `fallback` means missing or stale. */
  status: "fresh" | "rebuilt" | "fallback";
  summary: string | null;
  /** How many records the summary cites — what it actually stands on. */
  citationCount: number;
};

/**
 * The Asset Snapshot on the profile: a generated summary for quick orientation, and
 * nothing more (#196 user stories 48–50).
 *
 * Its whole design job is to *not* be mistaken for the truth. So it renders below the
 * profile header but above nothing that matters: every exact fact — the filter size,
 * the serial, the price — lives in the sections underneath, which are real records. The
 * card says out loud that it is generated and how many records it stands on.
 *
 * When the snapshot is missing or stale (`fallback`), the card renders **nothing at
 * all**. Degrading gracefully means the summary quietly disappears while the records
 * below carry on — never showing stale prose, and never showing an error that implies
 * the profile itself is broken. The user's facts are unaffected, so the page should not
 * act as if anything is wrong.
 */
export function AssetSnapshotCard({ status, summary, citationCount }: AssetSnapshotCardProps) {
  if (status === "fallback" || !summary?.trim()) {
    return null;
  }

  return (
    <section
      aria-label="Asset summary"
      className="rounded-lg border border-border/70 bg-muted/30 px-4 py-3"
      data-testid="asset-snapshot"
    >
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <SparklesIcon aria-hidden className="size-3" />
        Generated summary — the records below are the source of truth
      </p>

      <p className="mt-1.5 whitespace-pre-line text-sm">{summary}</p>

      {citationCount > 0 ? (
        <p className="mt-2 text-muted-foreground text-xs">
          Built from {citationCount === 1 ? "1 record" : `${citationCount} records`} on this asset.
        </p>
      ) : null}
    </section>
  );
}
